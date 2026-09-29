/* Le chien de garde : quand c'est l'extension qui casse.
 *
 * L'extension savait deja detecter trois de ses pannes -- selecteur mort,
 * source en repli, session perdue -- et aucune n'avait de voix. Leurs constats
 * allaient au journal, qu'on ouvre quand on soupconne deja quelque chose, ou a
 * un bandeau du popup, qu'on voit en l'ouvrant. Ni l'un ni l'autre ne
 * PREVIENT.
 *
 * Ce module change la nature de la chose. Une panne etait un COMPTEUR qui
 * monte ; elle devient un INCIDENT qui a une ouverture, une derniere
 * observation et une cloture. De la viennent les trois choses qui manquaient :
 * dire depuis quand, ne le dire qu'une fois, et savoir que c'est fini.
 *
 * Module PUR : aucune API d'extension, aucun acces reseau, aucune horloge. La
 * plomberie est dans background.js -- et c'est la, pas dans le cycle, que le
 * detecteur de veille arretee doit tourner. Voir `isStalled`.
 *
 * Conception : docs/specs/2026-09-22-chien-de-garde-design.md
 */
import { alerts as canaryAlerts, alertLine } from './canary.js';
import { failingSources } from './sentinel.js';
import { PROBED_STORES, SESSION, readSession } from './session.js';

/** Cle de stockage. Espace de la veille, jamais l'espace FGC_* du moteur. */
export const KEY_INCIDENTS = 'veille:incidents';

/** Les cinq genres d'incident. Trois reprennent un detecteur existant. */
export const KINDS = Object.freeze({
  /** Le magasin a bouge : un selecteur ne trouve plus rien. */
  SELECTOR: 'selector',
  /** Une source de decouverte echoue depuis assez longtemps pour le repli. */
  SOURCE: 'source',
  /** Le magasin dit lui-meme qu'il n'y a plus de session. */
  SESSION: 'session',
  /** La veille ne tourne plus. La seule panne qui n'avait aucun detecteur. */
  STALLED: 'stalled',
  /** Le systeme refuse nos notifications. Tout le reste est inaudible. */
  MUTED: 'muted',
});

/**
 * Sous ce delai, une veille en retard n'est pas une veille morte.
 *
 * Six heures : le pas nominal d'un reglage par defaut est de huit heures
 * (`floorPerDay: 3`). Sans ce plancher, une source forcee a la main -- donc un
 * `nextCycle` tout proche -- ferait declarer la veille morte au premier reveil
 * manque.
 */
export const STALL_FLOOR_MS = 6 * 3600000;

/**
 * Un ecart entre deux tours d'inspection plus grand que cela, c'est un
 * ordinateur qui dormait ou un navigateur ferme (2.99.1).
 *
 * L'alarme filet passe toutes les 30 minutes tant que le navigateur tourne :
 * trois fois ce pas ne s'explique que par un sommeil. Au reveil, le tour
 * d'inspection passe AVANT le rattrapage du cycle en retard -- et disait la
 * veille morte, « dernier cycle il y a 10 h », quelques secondes avant qu'elle
 * ne reparte toute seule. Ce tour-la ne juge donc pas la veille : le
 * rattrapage lui laisse sa chance, et le tour suivant, une demi-heure plus
 * tard, juge sur pieces.
 */
export const WAKE_GAP_MS = 90 * 60 * 1000;

/**
 * Multiple du pas prevu au-dela duquel on conclut.
 *
 * Deux laisse passer UN cycle manque sans crier : un portable ferme une nuit
 * ne doit rien declencher, et une alerte pour ca ferait couper les alertes.
 */
export const STALL_FACTOR = 2;

/** Les genres qui concernent l'extension entiere, et ne portent donc pas de cle. */
const SANS_CLE = new Set([KINDS.STALLED, KINDS.MUTED]);

/**
 * Les genres qui ne se notifient PAS.
 *
 * `muted` dit que le systeme refuse nos notifications : en envoyer une pour
 * l'annoncer serait absurde. Le badge et le popup le portent.
 */
const MUETS = new Set([KINDS.MUTED]);

/**
 * L'identite d'un incident.
 *
 * Le genre, et ce sur quoi il porte quand cela veut dire quelque chose. Une
 * cle vide produirait « stalled: », qui se lit mal et se compare mal.
 */
export function incidentKey({ kind, key } = {}) {
  return SANS_CLE.has(kind) || !key ? String(kind) : `${kind}:${key}`;
}

/* ------------------------------------------------------- la veille arretee */

/**
 * La veille a-t-elle cesse de tourner ?
 *
 * ATTENTION, ET C'EST LA DECISION CENTRALE DE CE MODULE : cette fonction ne
 * doit PAS etre appelee depuis un cycle. Quand la veille est morte, le cycle
 * ne tourne pas, donc le detecteur non plus -- un chien de garde qui dort avec
 * le chien qu'il garde ne garde rien. Elle s'evalue depuis le gestionnaire
 * d'alarme, qui survit a la mort du service worker, et depuis le popup a
 * l'ouverture.
 *
 * Elle ne lit que de l'etat persiste, ce qui la rend jouable sans rien
 * demarrer.
 */
export function isStalled({ lastCycle, nextCycle, now } = {}) {
  if (typeof now !== 'number') throw new TypeError('isStalled : "maintenant" est obligatoire');

  /* Jamais tourne : a l'installation, `lastCycle` est nul. Crier a ce
     moment-la accueillerait l'utilisateur par une alerte, pour un etat
     parfaitement normal. */
  if (!Number.isFinite(lastCycle)) return false;

  const pas = Number.isFinite(nextCycle) && nextCycle > lastCycle ? nextCycle - lastCycle : 0;
  const tolerance = Math.max(STALL_FLOOR_MS, STALL_FACTOR * pas);
  return now - lastCycle > tolerance;
}

/* -------------------------------------------------------- les observations */

/**
 * Ce qui ne va pas, a cet instant, d'apres l'etat persiste.
 *
 * Rend des observations nues -- genre, cle, motif -- et rien de plus : ni
 * date, ni memoire. C'est `reconcile` qui leur donne une histoire. Separer les
 * deux rend celui-ci rejouable a volonte, ce dont le service worker a besoin :
 * il peut mourir a tout moment et recommencer.
 */
export function observe({
  canary = {},
  sources = {},
  sessions = {},
  state = {},
  watchedStores = [],
  permissionLevel = 'granted',
  /** Vrai au premier tour apres un sommeil : la veille n'a pas encore pu rattraper son retard. */
  justWoke = false,
  now,
} = {}) {
  if (typeof now !== 'number') throw new TypeError('observe : "maintenant" est obligatoire');

  const vus = [];

  /* Le motif technique est recopie tel quel : c'est lui qui nomme le bouton
     manquant, et une capture de cette ligne a suffi a corriger la 2.13.2. */
  for (const a of canaryAlerts(canary)) {
    vus.push({ kind: KINDS.SELECTOR, key: a.store, detail: alertLine(a) });
  }

  for (const s of failingSources(sources)) {
    vus.push({
      kind: KINDS.SOURCE,
      key: s.name,
      detail: s.lastError ? `${s.failures} echec(s) -- ${s.lastError}` : `${s.failures} echec(s)`,
    });
  }

  /* SEULEMENT `logged_out`. Lecon de la 2.22.2, tenue jusqu'ici : une
     ignorance affichee comme une alerte fait passer « je ne sais pas » pour
     « c'est casse », et appelle un geste inutile. */
  const suivis = PROBED_STORES.filter((s) => !watchedStores.length || watchedStores.includes(s));
  for (const store of suivis) {
    const lu = readSession(sessions, store);
    if (lu.status !== SESSION.OUT) continue;
    vus.push({ kind: KINDS.SESSION, key: store, detail: lu.note || 'session absente' });
  }

  if (!justWoke && isStalled({ lastCycle: state.lastCycle, nextCycle: state.nextCycle, now })) {
    const retard = now - state.lastCycle;
    vus.push({
      kind: KINDS.STALLED,
      key: null,
      detail: `dernier cycle il y a ${Math.round(retard / 3600000)} h`,
    });
  }

  /* `granted` ou rien : une valeur inconnue vaut refus. Se tromper dans ce
     sens fait afficher un avertissement de trop ; se tromper dans l'autre fait
     croire que les notifications arrivent alors qu'elles sont bloquees. */
  if (permissionLevel !== 'granted') {
    vus.push({ kind: KINDS.MUTED, key: null, detail: `permission « ${permissionLevel} »` });
  }

  return vus;
}

/* --------------------------------------------- ouverture, reconstat, cloture */

/**
 * Confronte les incidents connus a ce qu'on observe maintenant.
 *
 * Trois sorties : l'etat suivant, ce qui vient de s'ouvrir, ce qui vient de se
 * fermer.
 *
 * LA CLOTURE EST IMPLICITE. Un incident que ce tour ne reconstate pas
 * disparait. Demander a chaque detecteur de fermer ce qu'il a ouvert finirait
 * par un oubli -- et un incident fantome fait chercher une panne qui n'existe
 * plus, ce qui use la confiance plus vite qu'un silence.
 */
export function reconcile(incidents, observed, { now } = {}) {
  if (typeof now !== 'number') throw new TypeError('reconcile : "maintenant" est obligatoire');

  const avant = incidents || {};
  const next = {};
  const opened = [];

  for (const vu of observed || []) {
    const id = incidentKey(vu);
    const connu = avant[id];

    if (connu) {
      /* L'ouverture ne bouge pas : « depuis mardi » ne se dit pas si elle se
         redate a chaque cycle. Le motif, lui, prend la valeur la plus
         recente -- c'est celle qui aide a corriger. */
      next[id] = {
        ...connu,
        lastSeenAt: now,
        detail: vu.detail ?? connu.detail ?? null,
      };
      continue;
    }

    next[id] = {
      id,
      kind: vu.kind,
      key: vu.key ?? null,
      openedAt: now,
      lastSeenAt: now,
      notifiedAt: null,
      detail: vu.detail ?? null,
    };
    opened.push(next[id]);
  }

  const closed = Object.values(avant).filter((i) => !next[i.id]);
  return { incidents: next, opened, closed };
}

/* ------------------------------------------------------------ la parole */

/**
 * Les incidents qui meritent d'etre dits, et ne l'ont pas encore ete.
 *
 * Le champ `notifiedAt` est PERSISTE, et c'est ce qui compte : un calcul
 * refait a chaque cycle redirait la meme chose a chaque reveil. Meme
 * construction que `notifiedAt` sur une offre, pour la meme raison.
 */
export function pendingNotices(incidents) {
  return Object.values(incidents || {})
    .filter((i) => !i.notifiedAt && !MUETS.has(i.kind))
    .sort((a, b) => a.openedAt - b.openedAt);
}

/** Fige le fait qu'on les a dits. */
export function markNotified(incidents, ids, { now } = {}) {
  if (typeof now !== 'number') throw new TypeError('markNotified : "maintenant" est obligatoire');

  const next = { ...(incidents || {}) };
  for (const id of ids || []) {
    if (next[id]) next[id] = { ...next[id], notifiedAt: now };
  }
  return next;
}

/**
 * Ce que le TELEPHONE n'a pas encore recu (2.47.0).
 *
 * Un marqueur a part, `phonedAt`, parce que les deux canaux ne tombent pas en
 * panne ensemble -- c'est tout leur interet. Et le genre `muted` y figure,
 * contrairement a `pendingNotices` : dire sur l'ordinateur que l'ordinateur
 * ne peut plus rien dire est absurde, le dire sur le telephone est la raison
 * d'etre de ce canal.
 */
export function phonePending(incidents) {
  return Object.values(incidents || {})
    .filter((i) => !i.phonedAt)
    .sort((a, b) => a.openedAt - b.openedAt);
}

/** Fige le fait que le telephone les a recus. */
export function markPhoned(incidents, ids, { now } = {}) {
  if (typeof now !== 'number') throw new TypeError('markPhoned : "maintenant" est obligatoire');

  const next = { ...(incidents || {}) };
  for (const id of ids || []) {
    if (next[id]) next[id] = { ...next[id], phonedAt: now };
  }
  return next;
}

/* ------------------------------------------------------------ l'affichage */

/** Les incidents ouverts, le plus ancien d'abord : c'est lui qui dure. */
export function openIncidents(incidents) {
  return Object.values(incidents || {}).sort((a, b) => a.openedAt - b.openedAt);
}

/** Une ligne lisible, motif technique compris quand il existe. */
export function incidentLine(incident) {
  if (!incident) return '';
  const quoi = incident.key ? `${incident.kind} (${incident.key})` : incident.kind;
  return incident.detail ? `${quoi} -- ${incident.detail}` : quoi;
}
