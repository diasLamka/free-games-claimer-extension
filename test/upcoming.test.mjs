/* « Bientot » ne menait nulle part.
 *
 * La section annonce les ouvertures a venir qu'Epic publie lui-meme : un titre,
 * une vignette, une heure. Trois informations, et aucun moyen d'aller voir le
 * jeu -- alors que c'est exactement ce qu'on veut faire en lisant la ligne.
 *
 * La cause etait en amont de l'interface : `upcomingWindows` ne gardait ni le
 * slug ni l'adresse de la fiche. Le popup n'avait donc rien a rendre
 * cliquable, et aucun bricolage d'affichage n'aurait pu l'inventer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { nextWindows, upcomingWindows, windowsLackLinks } from '../watch/sources/epic.js';

const T = Date.UTC(2026, 8, 22, 12, 0, 0);
const JOUR = 86400000;

/** Un element du flux Epic, avec une ouverture annoncee. */
function element(over = {}) {
  return {
    title: 'Cardpocalypse',
    productSlug: 'cardpocalypse',
    offerType: 'BASE_GAME',
    keyImages: [{ type: 'Thumbnail', url: 'https://cdn.example/card.jpg' }],
    promotions: {
      upcomingPromotionalOffers: [{
        promotionalOffers: [{
          startDate: new Date(T + JOUR).toISOString(),
          endDate: new Date(T + 8 * JOUR).toISOString(),
        }],
      }],
    },
    ...over,
  };
}

test('une ouverture annoncee porte l\'adresse de sa fiche', () => {
  const [w] = upcomingWindows(element(), T);

  assert.ok(w.url, 'une adresse');
  assert.match(w.url, /^https:\/\/store\.epicgames\.com\//);
  assert.match(w.url, /cardpocalypse/);
});

test('l\'adresse est celle que la reclamation utiliserait', () => {
  /* Deux facons de construire l'URL d'une meme fiche seraient deux facons de
     se tromper. Celle-ci passe par les memes fonctions que l'offre : meme
     base de chemin, meme slug, meme parametre de langue. */
  const [w] = upcomingWindows(element(), T);

  assert.match(w.url, /lang=/, 'la langue lisible par le moteur, comme pour une offre');
});

test('un element sans slug exploitable n\'invente pas d\'adresse', () => {
  /* Un lien mort est pire qu'une absence de lien : il fait cliquer pour rien,
     et donne l'impression que l'extension s'est trompee de jeu. */
  const [w] = upcomingWindows(element({ productSlug: null, slugUrl: null, catalogNs: null, offerMappings: [] }), T);

  assert.equal(w.url, null);
  assert.equal(w.title, 'Cardpocalypse', 'le reste de la ligne survit');
});

test('le titre et la vignette ne bougent pas', () => {
  /* Ce qui marchait doit continuer : la section affichait deja les deux. */
  const [w] = upcomingWindows(element(), T);

  assert.equal(w.title, 'Cardpocalypse');
  assert.equal(w.image, 'https://cdn.example/card.jpg');
  assert.equal(w.start, T + JOUR);
});

test('une ouverture deja passee n\'est pas annoncee', () => {
  const passees = upcomingWindows(element({
    promotions: {
      upcomingPromotionalOffers: [{
        promotionalOffers: [{ startDate: new Date(T - JOUR).toISOString() }],
      }],
    },
  }), T);

  assert.deepEqual(passees, []);
});

test('l\'adresse traverse le regroupement de toutes les sources', () => {
  /* `nextWindows` est ce que le cycle persiste, et c'est de la que le popup
     lit. Une adresse perdue a cette etape ne se verrait qu'a l'ecran. */
  const toutes = nextWindows([element()], T);

  assert.equal(toutes.length, 1);
  assert.ok(toutes[0].url);
});

test('des fenetres ecrites avant la 2.35.0 sont reperees', () => {
  /* Constate le 2026-09-22 : la mise a jour etait installee, mais les fenetres
     stockees dataient d'avant elle, et la source ne serait reinterrogee que
     des jours plus tard. « Bientot » restait sans liens tout ce temps. */
  const anciennes = [{ title: 'Mechabellum', image: 'https://cdn/m.jpg', start: T, end: T + JOUR }];
  assert.equal(windowsLackLinks(anciennes), true);
});

test('des fenetres a jour, ou sans titre a montrer, ne demandent rien', () => {
  assert.equal(windowsLackLinks(nextWindows([element()], T)), false);
  // L'ancienne forme, un simple instant, n'a jamais eu de ligne cliquable.
  assert.equal(windowsLackLinks([T + JOUR]), false);
  assert.equal(windowsLackLinks([]), false);
  assert.equal(windowsLackLinks(undefined), false);
});
