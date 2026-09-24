/* La jaquette du jeu dans la notification (2.63.0). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { IMAGE_W, IMAGE_H, MAX_BYTES, coverCrop, toBase64, notificationImage } from '../watch/notify-image.js';
import { composeAnnouncement } from '../watch/cycle.js';
import { setLocale } from '../lib/i18n.js';

const ROOT = new URL('../', import.meta.url);
const lire = (f) => readFileSync(new URL(f, ROOT), 'utf8');

/* ------------------------------------------------------------ le recadrage */

test('le recadrage garde le centre, au format 2:1, sans deformer', () => {
  // Une vignette Epic, 2560 x 1440 : trop haute, on coupe en haut et en bas.
  assert.deepEqual(coverCrop(2560, 1440), { sx: 0, sy: 80, sw: 2560, sh: 1280 });
  // Un en-tete Steam, 460 x 215 : trop large, on coupe sur les cotes.
  assert.deepEqual(coverCrop(460, 215), { sx: 15, sy: 0, sw: 430, sh: 215 });
  assert.deepEqual(coverCrop(720, 360), { sx: 0, sy: 0, sw: 720, sh: 360 });
  assert.equal(coverCrop(0, 100), null);
  assert.equal(coverCrop(NaN, 100), null);
});

test('base64 par tranches : un grand tableau ne fait pas deborder la pile', () => {
  const octets = new Uint8Array(200000).map((_, i) => (i * 31) % 256);
  assert.equal(toBase64(octets), Buffer.from(octets).toString('base64'));
  assert.equal(toBase64(new Uint8Array(0)), '');
});

/* ------------------------------------------------------------ le telechargement */

function reponse({ ok = true, type = 'image/jpeg', taille = 50000, annonce = null } = {}) {
  const octets = new Uint8Array(taille).fill(7);
  return {
    ok,
    headers: { get: (k) => (k === 'content-type' ? type : k === 'content-length' ? (annonce ?? String(taille)) : null) },
    blob: async () => new Blob([octets], { type }),
  };
}

function fauxFetch(r) {
  const appels = [];
  const f = async (url, init) => { appels.push({ url, init }); if (r instanceof Error) throw r; return r; };
  f.appels = appels;
  return f;
}

/** Une toile factice : elle retient ce qu'on y dessine, et rend trois octets. */
function fausseToile() {
  const dessins = [];
  class Toile {
    constructor(w, h) { this.w = w; this.h = h; }
    getContext() { return { drawImage: (...a) => dessins.push(a) }; }
    async convertToBlob(opts) { this.opts = opts; return new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }); }
  }
  const fermees = [];
  const bitmap = async () => ({ width: 2560, height: 1440, close() { fermees.push(true); } });
  return { Toile, bitmap, dessins, fermees };
}

const URL_EPIC = 'https://cdn1.epicgames.com/spt-assets/984cdc148ea6423e866ca6e04a1b429f/mindcop-kplp1.jpg';

test('la jaquette est telechargee sans cookies ni referent, recadree, et rendue en data: JPEG', async () => {
  const f = fauxFetch(reponse({ taille: 978003 }));
  const t = fausseToile();
  const data = await notificationImage(URL_EPIC, { fetch: f, createImageBitmap: t.bitmap, OffscreenCanvas: t.Toile });
  assert.equal(data, `data:image/jpeg;base64,${Buffer.from([1, 2, 3]).toString('base64')}`);
  assert.equal(f.appels[0].init.credentials, 'omit');
  assert.equal(f.appels[0].init.referrerPolicy, 'no-referrer');
  assert.deepEqual(t.dessins[0].slice(1), [0, 80, 2560, 1280, 0, 0, IMAGE_W, IMAGE_H]);
  assert.equal(t.fermees.length, 1, 'l\'image decodee est liberee');
});

test('tout ce qui cloche vaut « pas d\'image » -- jamais une erreur', async () => {
  const t = fausseToile();
  const avec = (r) => notificationImage(URL_EPIC, { fetch: fauxFetch(r), createImageBitmap: t.bitmap, OffscreenCanvas: t.Toile });
  assert.equal(await avec(reponse({ ok: false })), null, 'HTTP en erreur');
  assert.equal(await avec(reponse({ type: 'text/html' })), null, 'pas une image');
  assert.equal(await avec(reponse({ annonce: String(MAX_BYTES + 1) })), null, 'trop lourde, avant meme de telecharger');
  assert.equal(await avec(new Error('reseau')), null, 'le reseau tombe');

  const jamais = fauxFetch(reponse());
  for (const mauvaise of ['http://cdn1.epicgames.com/x.jpg', 'javascript:alert(1)', '', null, 42]) {
    assert.equal(await notificationImage(mauvaise, { fetch: jamais }), null, String(mauvaise));
  }
  assert.equal(jamais.appels.length, 0, 'une adresse douteuse ne part meme pas');
});

test('sans toile, une image legere passe telle quelle ; une lourde, non', async () => {
  const sans = { createImageBitmap: undefined, OffscreenCanvas: undefined };
  const petite = await notificationImage(URL_EPIC, { ...sans, fetch: fauxFetch(reponse({ type: 'image/png', taille: 1000 })) });
  assert.match(petite, /^data:image\/png;base64,/);
  assert.equal(await notificationImage(URL_EPIC, { ...sans, fetch: fauxFetch(reponse({ taille: 978003 })) }), null);
});

/* ------------------------------------------------------------ le texte et le branchement */

test('l\'annonce d\'un jeu dit le temps qui reste, quand on le connait', () => {
  setLocale('fr');
  try {
    const now = Date.parse('2026-09-24T08:00:00Z');
    const mindcop = { title: 'Mindcop', store: 'epic', end: now + 7 * 3600000 + 9 * 60000 };
    assert.deepEqual(composeAnnouncement([mindcop], null, now), {
      title: 'Gratuit : Mindcop',
      text: 'Gratuit sur Epic Games Store · encore 7 h 09',
    });
    assert.equal(composeAnnouncement([{ ...mindcop, end: null }], null, now).text, 'Gratuit sur Epic Games Store');
    assert.equal(composeAnnouncement([mindcop]).text, 'Gratuit sur Epic Games Store', 'sans horloge, pas de compte');
    assert.equal(composeAnnouncement([{ ...mindcop, end: now + 9 * 86400000 }], null, now).text,
      'Gratuit sur Epic Games Store · encore 9 j 0 h', 'une semaine ne se compte pas en heures');
  } finally { setLocale(null); }
});

test('le worker essaie l\'image, puis la notification simple ; le cycle ne l\'envoie pas pour un resume', () => {
  const bg = lire('background.js');
  assert.match(bg, /import \{ notificationImage \} from '\.\/watch\/notify-image\.js';/);
  assert.match(bg, /const imageUrl = image \? await notificationImage\(image\) : null;/);
  assert.match(bg, /const essais = \[\s*illustree && boutons\.length \? \{ \.\.\.illustree, buttons: boutons \} : null,\s*illustree,\s*boutons\.length \? \{ \.\.\.base, buttons: boutons \} : null,\s*base,\s*\]/);
  const cycle = lire('watch/cycle.js');
  assert.match(cycle, /image: decision\.digest \? null : \(first\.image \|\| null\),/);
  assert.match(cycle, /image: closing\[0\]\.image \|\| null,/);
});
