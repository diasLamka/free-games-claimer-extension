/* L'autonomie (2.112.0) : l'extension recupere-t-elle vraiment seule, et qu'est-ce qui la freine ?
 *
 * Elle recupere seule depuis longtemps -- la veille ouvre la page du magasin, joue l'etape, referme. Ce qui manquait n'etait pas le
 * geste, c'etait de savoir s'il pouvait aboutir : une session perdue, une verification humaine que l'extension ne resout jamais, un
 * Chrome qu'on ferme, l'arret d'urgence. Ce module lit ce que l'extension sait deja et le dit en trois mots, plus ce qu'elle a pris
 * SEULE sur quatorze jours, a distinguer de ce qui l'a ete a ta demande (« Tout recuperer »).
 *
 * Rien n'est mesure ici : tout vient de ce qui a ete note. Module pur : aucune API d'extension, aucune horloge implicite.
 */
import { PROBED_STORES, SESSION, readSession } from './session.js';

export const WINDOW_DAYS = 14;
const WINDOW_MS = WINDOW_DAYS * 24 * 3600 * 1000;

export const LEVEL = Object.freeze({
  /** Rien ne la freine. */
  ON: 'on',
  /** Elle recupere seule, mais quelque chose la freine. */
  PARTIAL: 'partial',
  /** La reclamation autonome est coupee, ou l'arret d'urgence est enclenche. */
  OFF: 'off',
});

export const BLOCK = Object.freeze({
  /** La reclamation autonome est coupee dans les reglages. */
  OFF: 'off',
  /** L'arret d'urgence est enclenche : rien ne se recupere. */
  STOPPED: 'stopped',
  /** Sans la permission d'arriere-plan, Chrome doit rester ouvert. */
  CLOSED: 'closed',
  /** La session de ces magasins est perdue. */
  SESSIONS: 'sessions',
  /** Ces magasins ont demande une verification humaine sur un jeu pas encore pris. */
  CHALLENGES: 'challenges',
});

const ACQUIRED = ['claimed', 'redeemed'];

function recent(entry, now) {
  return entry && typeof entry === 'object' && Number.isFinite(entry.updatedAt) && now - entry.updatedAt <= WINDOW_MS && entry.updatedAt <= now;
}

/**
 * `settings`, `catalog` (par cle), `sessions` (veille:sessions), `stopped` (arret d'urgence), `backgroundSupported` /
 * `backgroundGranted` (la permission facultative), `claimableStores` (les magasins qu'on reclame), `now`.
 */
export function autonomyReport({ settings, catalog, sessions, stopped = false, backgroundSupported = false, backgroundGranted = false, claimableStores = [], now }) {
  if (typeof now !== 'number') throw new TypeError('autonomyReport : "maintenant" est obligatoire');
  const entries = Object.values(catalog && typeof catalog === 'object' ? catalog : {}).filter((e) => recent(e, now));
  const recentAcquired = entries.filter((e) => ACQUIRED.includes(e.verdict) && typeof e.alone === 'boolean');
  const counts = {
    alone: recentAcquired.filter((e) => e.alone === true).length,
    withYou: recentAcquired.filter((e) => e.alone === false).length,
  };

  if (settings && settings.autonomousClaim === false) return { level: LEVEL.OFF, blocks: [{ kind: BLOCK.OFF }], ...counts };
  if (stopped === true) return { level: LEVEL.OFF, blocks: [{ kind: BLOCK.STOPPED }], ...counts };

  const watched = new Set(claimableStores);
  const blocks = [];

  if (backgroundSupported && backgroundGranted === false) blocks.push({ kind: BLOCK.CLOSED });

  const lost = PROBED_STORES.filter((s) => watched.has(s) && readSession(sessions, s).status === SESSION.OUT);
  if (lost.length) blocks.push({ kind: BLOCK.SESSIONS, stores: lost });

  const asked = [...new Set(entries.filter((e) => e.verdict === 'challenge' && watched.has(e.store)).map((e) => e.store))];
  if (asked.length) blocks.push({ kind: BLOCK.CHALLENGES, stores: asked });

  return { level: blocks.length ? LEVEL.PARTIAL : LEVEL.ON, blocks, ...counts };
}
