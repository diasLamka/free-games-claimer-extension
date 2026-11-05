/* Le compte a rebours : deux heures avant la sortie, verifier que tout est pret.
 *
 * La veille sait QUAND Epic ouvre (le jeudi 11:00 a New York, ou une fenetre qu'il a annoncee). Elle ne sait pas, au moment
 * d'y arriver, si l'utilisateur a perdu sa session, si le telephone a disparu du relais, ou si l'alerte telephone est en
 * panne depuis lundi. Chacune de ces pannes se voit deja quelque part -- dans l'onglet Sessions, dans le relais, dans
 * l'etat du telephone --, mais personne ne les regarde le jeudi a 15 h. Ce module regarde, UNE FOIS par sortie, et parle
 * seulement s'il y a quelque chose a dire.
 *
 * QUATRE REGLES.
 *
 *  1. UNE PASSE PAR SORTIE. L'etat retient pour quelle ouverture la passe a eu lieu : deux tours d'inspection dans la meme
 *     fenetre de deux heures ne disent pas deux fois la meme chose.
 *  2. SILENCE QUAND TOUT VA BIEN. Une passe sans probleme n'ecrit rien a l'ecran et n'envoie rien : c'est la regle qui
 *     compte le plus. Un compte a rebours qui sonne chaque semaine pour dire "tout va bien" est un compte a rebours
 *     qu'on coupe.
 *  3. SEUL CE QUI EST SUR COMPTE. Une session "inconnue" n'est pas une session perdue (voir session.js) : elle ne
 *     declenche rien. Seul un "deconnecte" confirme le fait.
 *  4. LA PASSE NE REPARE RIEN. Elle dit ce qui cloche et ce qu'il faut faire ; le geste reste celui de l'utilisateur.
 *
 * Module pur : tout vient en parametre, aucune horloge implicite.
 */
import { SESSION, PROBED_STORES, readSession } from './session.js';

/** Ou l'etat de la passe vit dans le stockage. */
export const KEY_PREFLIGHT = 'veille:avant-sortie';

/** On regarde dans les deux heures qui precedent l'ouverture. */
export const LEAD_MS = 2 * 60 * 60 * 1000;

/** Un telephone du relais qu'on n'a pas entendu depuis ce temps n'est probablement plus la. */
export const PEER_STALE_MS = 12 * 60 * 60 * 1000;

/**
 * Un probleme deja DIT recemment n'est pas redit : le chien de garde (health.js) previent d'une session perdue, et une passe
 * qui repete la meme chose dix minutes plus tard serait du bruit. Au-dela, la passe le rappelle -- c'est justement l'interet :
 * celui qui a ferme la notification de mardi doit la revoir le jeudi a 15 h.
 */
export const RECENT_MS = 6 * 60 * 60 * 1000;

/** Les choses qu'une passe peut trouver. */
export const KINDS = Object.freeze({
  SESSION: 'session',
  RELAY: 'relay',
  PHONE: 'phone',
});

/** L'etat de la derniere passe : pour quelle ouverture, et quand. */
export function readPreflight(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    for: Number.isFinite(r.for) ? r.for : null,
    at: Number.isFinite(r.at) ? r.at : null,
    problems: Number.isInteger(r.problems) && r.problems >= 0 ? r.problems : 0,
  };
}

/** La prochaine ouverture, strictement apres `now` -- ou null. */
export function nextDrop(instants, now) {
  let best = null;
  for (const t of instants || []) {
    if (Number.isFinite(t) && t > now && (best === null || t < best)) best = t;
  }
  return best;
}

/** La passe de cette ouverture est-elle due : dans les deux heures qui precedent, et pas encore faite ? */
export function isDue(state, target, now) {
  if (!Number.isFinite(target) || target <= now) return false;
  if (target - now > LEAD_MS) return false;
  return readPreflight(state).for !== target;
}

/**
 * Ce qui cloche, d'apres l'etat PERSISTE.
 *
 * `sessions` : l'etat des sessions ; `watchedStores` : les magasins suivis ; `relay` : le relais lu (ou null) ;
 * `phoneOn` : le telephone est-il configure ; `phoneState` : le dernier envoi au telephone ; `incidents` : ce que le chien de
 * garde a ouvert et dit.
 * Rend une liste de `{ kind, key, detail }`, vide quand tout va bien.
 */
export function findProblems({ sessions, watchedStores, relay, phoneOn, phoneState, incidents, now } = {}) {
  const out = [];
  const ditRecemment = (store) => Object.values(incidents || {}).some(
    (i) => i && i.kind === KINDS.SESSION && i.key === store && Number.isFinite(i.notifiedAt) && now - i.notifiedAt < RECENT_MS,
  );

  for (const store of watchedStores || []) {
    if (!PROBED_STORES.includes(store)) continue;
    // Seul "deconnecte" compte : " inconnu " veut dire qu'on ne sait pas, jamais qu'on a perdu la session.
    if (readSession(sessions, store).status === SESSION.OUT && !ditRecemment(store)) out.push({ kind: KINDS.SESSION, key: store, detail: null });
  }

  if (relay) {
    /* Jamais entendu depuis l'association : on compte depuis l'association, pas depuis toujours. Sans aucune date, on ne
       sait rien, et on ne dit rien (regle 3). */
    const vu = relay.peer && Number.isFinite(relay.peer.at) ? relay.peer.at : null;
    const depuis = vu !== null ? vu : (Number.isFinite(relay.pairedAt) ? relay.pairedAt : null);
    if (depuis !== null && now - depuis > PEER_STALE_MS) out.push({ kind: KINDS.RELAY, key: null, detail: null });
  }

  if (phoneOn && phoneState && phoneState.ok === false) {
    out.push({ kind: KINDS.PHONE, key: null, detail: typeof phoneState.note === 'string' ? phoneState.note.slice(0, 80) : null });
  }

  return out;
}
