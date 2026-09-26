/* « Copier la liste » : les jeux gratuits du moment, a coller ailleurs (2.80.0). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { MAX_GAMES, composeShareList } from '../watch/share-list.js';
import { setLocale, t } from '../lib/i18n.js';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-09-26T12:00:00Z');
const DAY = 24 * 3600 * 1000;
const LABELS = { epic: 'Epic Games Store', steam: 'Steam', 'epic-mobile': 'Epic Games (mobile)' };
const fr = {
  t, storeLabel: (s) => LABELS[s] || s,
  dateText: (ms) => new Date(ms).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
  dayText: (ms) => new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' }),
  worthText: (o) => o.worth || null,
};

const MECHA = { store: 'epic', title: 'Mechabellum', url: 'https://store.epicgames.com/fr/p/mechabellum', end: Date.parse('2026-10-01T15:00:00Z'), worth: '14,99 €', category: null };
const DWARVEN = { store: 'steam', title: 'Dwarven Realms (Steam) Key Giveaway', resolveUrl: 'https://www.gamerpower.com/open/dwarven-realms-steam-key-giv', end: null, worth: null };
const PACK = { store: 'steam', title: 'Explosive Odds - Supporter Pack', url: 'https://store.steampowered.com/app/4059370/', end: NOW + 3 * DAY, category: 'DLC' };

test('un texte pret a coller : en-tete, un jeu par ligne, son lien dessous', () => {
  setLocale('fr');
  try {
    const texte = composeShareList({ ...fr, now: NOW, offers: [MECHA, DWARVEN, PACK] });
    const l = texte.split('\n');
    assert.equal(l[0], 'Jeux gratuits à récupérer — samedi 26 septembre');
    assert.equal(l[1], '');
    assert.equal(l[2], '• Mechabellum — Epic Games Store — 14,99 € — jusqu’au jeu. 1 oct., 17:00');
    assert.equal(l[3], '  https://store.epicgames.com/fr/p/mechabellum');
    assert.equal(l[4], '• Dwarven Realms — Steam — sans date de fin', 'sans le suffixe de GamerPower');
    assert.equal(l[5], '  https://www.gamerpower.com/open/dwarven-realms-steam-key-giv', 'le lien de resolution a defaut de mieux');
    assert.match(l[6], /^• Explosive Odds - Supporter Pack — Steam · DLC — jusqu’au /);
    assert.doesNotMatch(texte, /\*\*|__|<https/, 'du texte simple : Discord et WhatsApp le lisent pareil');
  } finally { setLocale(null); }
});

test('bientot et les week-ends Steam, seulement s\'il y en a', () => {
  setLocale('fr');
  try {
    const seul = composeShareList({ ...fr, now: NOW, offers: [MECHA] });
    assert.doesNotMatch(seul, /Bientôt|week-end/);
    const texte = composeShareList({
      ...fr, now: NOW, offers: [MECHA],
      soon: [
        { title: 'Hades', store: 'epic', start: Date.parse('2026-10-01T15:00:00Z'), url: 'https://store.epicgames.com/fr/p/hades' },
        { title: null, store: 'epic', start: NOW + DAY },
        { title: 'Passe', store: 'epic', start: NOW - DAY },
      ],
      weekends: [{ title: 'Squad', end: Date.parse('2026-09-28T17:00:00Z'), url: 'https://store.steampowered.com/app/393380/Squad/' }],
    });
    assert.match(texte, /\n\nBientôt :\n• Hades — Epic Games Store — à partir du jeu\. 1 oct\., 17:00\n  https:\/\/store\.epicgames\.com\/fr\/p\/hades/);
    assert.doesNotMatch(texte, /Passe/, 'une fenetre passee ne s\'annonce plus');
    assert.match(texte, /\n\nÀ essayer gratuitement ce week-end sur Steam :\n• Squad — jusqu’au lun\. 28 sept\., 19:00\n  https:\/\/store\.steampowered\.com\/app\/393380\/Squad\//);
  } finally { setLocale(null); }
});

test('un mur de jeux se coupe : les suivants sont comptes', () => {
  const offres = Array.from({ length: MAX_GAMES + 4 }, (_, i) => ({ store: 'epic', title: `Jeu ${i}`, end: null }));
  const texte = composeShareList({ ...fr, now: NOW, offers: offres });
  assert.equal(texte.split('\n').filter((l) => l.startsWith('• ')).length, MAX_GAMES);
  assert.match(texte, /\n\+4$/);
});

test('rien de personnel, et aucun lien douteux', () => {
  const texte = composeShareList({
    ...fr, now: NOW,
    offers: [{ store: 'epic', title: 'Piege', url: 'javascript:alert(1)', end: null }, { store: 'epic', title: 'Espace', url: 'https://a b', end: null }],
  });
  assert.doesNotMatch(texte, /javascript:|https:\/\/a b/);
  // Le module ne connait ni la bibliotheque, ni les souhaits, ni les codes.
  const src = lire('watch/share-list.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(src, /bibliotheque|souhait|FGC_pending_codes|KEY_/);
});

test('les quatre langues ont leurs phrases', () => {
  for (const l of ['en', 'fr', 'de', 'es']) {
    const table = JSON.parse(lire(`_locales/${l}/messages.json`));
    for (const k of ['shareButton', 'shareButtonTitle', 'shareHeader', 'shareUntil', 'shareNoEnd', 'shareUpcoming', 'shareFrom', 'shareWeekends']) {
      assert.ok(table[k] && table[k].message, `${l} ${k}`);
    }
  }
});

test('le bouton copie ce qui est affiche', () => {
  const popup = lire('pages/popup.js');
  assert.match(popup, /shownOffers = visible\.map\(\(\{ offer \}\) => offer\);/);
  assert.match(popup, /document\.getElementById\('share-row'\)\.hidden = !visible\.length;/);
  assert.match(popup, /await navigator\.clipboard\.writeText\(texte\)/);
  assert.match(lire('pages/popup.html'), /<button class="btn-sm" id="share-list" data-i18n="shareButton"/);
});
