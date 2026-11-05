/* Le souffle : ne pas se presenter au magasin quand il pose le plus de defis.
 *
 * Un defi (captcha, verification de securite) arrete une recuperation et laisse un onglet ouvert dans la fenetre de
 * l'utilisateur. Les magasins n'en posent pas a toute heure : l'extension apprend, sur CETTE machine, a quelles heures de la
 * journee chaque magasin lui en a pose, et ne decale que les recuperations qui peuvent attendre vers une heure plus calme.
 *
 * ON NE CONTOURNE JAMAIS UN CAPTCHA. Rien ici ne tente de le resoudre, de le masquer ni de se faire passer pour autre chose :
 * on choisit seulement l'heure a laquelle on se presente. Un defi, quand il arrive, reste rendu a l'humain comme avant.
 *
 * QUATRE GARDE-FOUS.
 *
 *  1. PAS DE CONCLUSION SANS DONNEES. Sous `MIN_ATTEMPTS` essais ET `MIN_CHALLENGES` defis pour un magasin, il n'y a pas
 *     de profil : rien n'est decale. Un magasin qui n'a jamais pose de defi n'en aura jamais pour l'extension.
 *  2. UNE HEURE EST MAUVAISE SI ET SEULEMENT SI elle a assez d'essais, assez de defis, et un taux au moins double du taux
 *     moyen du magasin : un defi isole a 3 h du matin ne ferme pas la nuit.
 *  3. JAMAIS AU-DELA DE LA FIN D'OFFRE. Seules les offres dont la fin est connue et a plus de `URGENT_MS` sont decalees, et
 *     jamais de plus de `MAX_WAIT_MS` : il reste toujours au moins la moitie de ce delai avant la fin.
 *  4. LA DEMANDE DE L'UTILISATEUR PASSE TOUJOURS. " Tout recuperer " et " Recuperer " ne sont jamais decales (voir cycle.js).
 *
 * Statistiques locales : un compteur d'essais et de defis par magasin et par heure de la journee. Aucun titre, aucune
 * adresse, aucun code ; rien ne quitte la machine, rien n'entre dans une sauvegarde.
 *
 * Module pur : l'heure et le fuseau sont des parametres.
 */
import { localParts, validZone } from './schedule/clock.js';

/** Ou les statistiques vivent dans le stockage. */
export const KEY_BREATH = 'veille:souffle';

export const HOURS = 24;
/** Pas de profil sous ces deux seuils (garde-fou 1). */
export const MIN_ATTEMPTS = 30;
export const MIN_CHALLENGES = 5;
/** Une heure mauvaise (garde-fou 2). */
export const MIN_HOUR_ATTEMPTS = 6;
export const MIN_HOUR_CHALLENGES = 3;
export const BAD_FACTOR = 2;
export const BAD_FLOOR = 0.25;
/** Une offre qui finit dans moins d'un jour n'attend pas ; on n'attend jamais plus de douze heures (garde-fou 3). */
export const URGENT_MS = 24 * 60 * 60 * 1000;
export const MAX_WAIT_MS = 12 * 60 * 60 * 1000;
/** Au-dela de ce nombre d'essais, les compteurs sont divises par deux : le profil suit l'evolution du magasin. */
export const MAX_TOTAL = 400;

const HOUR_MS = 60 * 60 * 1000;

function emptyStat() {
  return { n: new Array(HOURS).fill(0), c: new Array(HOURS).fill(0) };
}

function readStat(raw) {
  const out = emptyStat();
  if (!raw || typeof raw !== 'object') return out;
  for (let h = 0; h < HOURS; h++) {
    const n = Array.isArray(raw.n) ? raw.n[h] : 0;
    const c = Array.isArray(raw.c) ? raw.c[h] : 0;
    out.n[h] = Number.isInteger(n) && n > 0 ? n : 0;
    // Un defi est un essai : jamais plus de defis que d'essais.
    out.c[h] = Math.min(out.n[h], Number.isInteger(c) && c > 0 ? c : 0);
  }
  return out;
}

/** Les statistiques, relues avec la forme qu'elles doivent avoir. */
export function readBreath(raw) {
  const stores = {};
  const src = raw && typeof raw === 'object' && raw.stores && typeof raw.stores === 'object' ? raw.stores : {};
  for (const [store, stat] of Object.entries(src)) {
    if (typeof store === 'string' && store) stores[store] = readStat(stat);
  }
  return { stores };
}

/** Le fuseau de la machine, ou UTC. */
export function localZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/** L'heure de la journee (0-23) dans le fuseau donne ; UTC si le fuseau est inconnu. */
export function hourOf(now, zone) {
  return localParts(now, validZone(zone) ? zone : 'UTC').hour;
}

/** Note un essai (et son defi eventuel) pour un magasin, a l'heure locale de `now`. Rend de NOUVELLES statistiques. */
export function recordAttempt(breath, store, challenged, now, zone) {
  if (!store || !Number.isFinite(now)) return readBreath(breath);
  const b = readBreath(breath);
  const stat = b.stores[store] || emptyStat();
  const h = hourOf(now, zone);
  stat.n[h] += 1;
  if (challenged) stat.c[h] += 1;
  if (stat.n.reduce((a, x) => a + x, 0) > MAX_TOTAL) {
    for (let i = 0; i < HOURS; i++) {
      stat.n[i] = Math.floor(stat.n[i] / 2);
      stat.c[i] = Math.min(stat.n[i], Math.floor(stat.c[i] / 2));
    }
  }
  return { stores: { ...b.stores, [store]: stat } };
}

/**
 * Ce que l'on sait d'un magasin : `{ enough, total, challenges, rate, bad }`, `bad` etant les vingt-quatre heures (vrai =
 * mauvaise). `enough` faux veut dire " on ne sait pas " -- jamais " tout va bien ".
 */
export function profile(breath, store) {
  const stat = readBreath(breath).stores[store] || emptyStat();
  const total = stat.n.reduce((a, x) => a + x, 0);
  const challenges = stat.c.reduce((a, x) => a + x, 0);
  const rate = total ? challenges / total : 0;
  const enough = total >= MIN_ATTEMPTS && challenges >= MIN_CHALLENGES;
  const bad = stat.n.map((n, h) => (
    enough && n >= MIN_HOUR_ATTEMPTS && stat.c[h] >= MIN_HOUR_CHALLENGES
      && stat.c[h] / n >= Math.max(BAD_FACTOR * rate, BAD_FLOOR)
  ));
  return { enough, total, challenges, rate, bad };
}

/** Le debut de l'heure locale suivante, en ms (les fuseaux a demi-heure sont servis par les minutes locales). */
function nextHourStart(now, zone) {
  const p = localParts(now, validZone(zone) ? zone : 'UTC');
  return now + (60 - p.minute) * 60000 - p.second * 1000 - (now % 1000);
}

/**
 * Faut-il attendre pour cette offre ? `{ wait: false }` ou `{ wait: true, until }`.
 *
 * On attend quand : le magasin a un profil, l'heure presente est mauvaise, l'offre ne finit pas avant `URGENT_MS`, et une
 * heure calme arrive dans les `MAX_WAIT_MS`. On vise le DEBUT de la premiere heure qui n'est pas mauvaise.
 */
export function decide({ breath, store, end, now, zone }) {
  const sans = { wait: false };
  if (!store || !Number.isFinite(now)) return sans;
  // Sans fin connue, on ne sait pas si l'offre peut attendre : on ne l'attend pas.
  if (!Number.isFinite(end) || end - now < URGENT_MS) return sans;

  const p = profile(breath, store);
  if (!p.enough) return sans;
  if (!p.bad[hourOf(now, zone)]) return sans;

  let debut = nextHourStart(now, zone);
  while (debut - now <= MAX_WAIT_MS) {
    if (!p.bad[hourOf(debut, zone)]) return { wait: true, until: debut };
    debut += HOUR_MS;
  }
  return sans;
}

/** Les offres a ne pas tenter maintenant, d'apres leurs magasins et leurs fins. Rend l'ensemble de leurs cles. */
export function heldKeys(offers, { breath, now, zone }) {
  const out = new Set();
  for (const o of offers || []) {
    if (!o || !o.catalogKey) continue;
    if (decide({ breath, store: o.store, end: o.end, now, zone }).wait) out.add(o.catalogKey);
  }
  return out;
}
