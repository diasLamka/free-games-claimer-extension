/* Le mode repli : quand la veille automatique ne suffit plus.
 *
 * Le design le prevoit au §10. Apres trois echecs consecutifs d'une source, un
 * onglet dedie reprend la decouverte avec un chronometre fiable, affiche en
 * clair que le repli est actif et pourquoi, et rend la main des que la source
 * redevient saine. Il ne devient JAMAIS le mode par defaut.
 *
 * CE QUE LA SENTINELLE APPORTE VRAIMENT, ET CE QU'ELLE N'APPORTE PAS.
 *
 * Elle n'a pas de pouvoir magique sur une source en panne : si gamerpower rend
 * 503, une page le lira aussi mal qu'un service worker. Ce qu'elle a, et que
 * le worker n'a pas :
 *
 *   ELLE PASSE OUTRE LE RECUL. Trois echecs endorment une source des heures
 *   (`backoffAfterFailures`), ce qui est le bon comportement quand personne ne
 *   regarde. Quelqu'un qui ouvre cette page regarde, justement, et veut
 *   reessayer maintenant. C'est tout l'interet du repli, et c'est la seule
 *   chose qui le distingue d'un cycle ordinaire.
 *
 *   ELLE A UNE HORLOGE FIABLE. Un onglet ouvert compte le temps sans dependre
 *   d'une alarme a plancher, ni d'un worker qui meurt entre deux.
 *
 *   ELLE DIT POURQUOI. Une veille qui echoue en silence est le mode d'echec le
 *   plus cher de ce projet -- c'est deja ce qui a justifie le journal et le
 *   canari.
 *
 * ELLE N'ECRIT NI LE CATALOGUE NI LE JOURNAL. Elle DEMANDE un cycle au service
 * worker, qui reste l'ecrivain unique. Deux contextes qui lisent-modifient-
 * ecrivent la meme cle perdent une ecriture -- le test du journal le montre
 * avec le faux chrome a latence. Dupliquer le chemin d'ecriture pour gagner
 * quelques millisecondes serait echanger une panne visible contre une panne
 * silencieuse.
 *
 * Les decisions sont pures ; les trois fonctions qui touchent au stockage
 * recoivent leur `chrome` en parametre.
 */

/** Le battement de coeur de la sentinelle. Espace de la veille. */
export const KEY_SENTINEL = 'veille:sentinelle';

/** Trois echecs consecutifs : le seuil du design (§10). */
export const FALLBACK_AFTER = 3;

/**
 * Au-dela, le battement est perime et la sentinelle est reputee fermee.
 *
 * C'est la propriete de surete de tout ce fichier : un onglet ferme -- ou un
 * navigateur tue -- ne peut pas laisser la veille croire qu'elle est prise en
 * charge. Le worker reprend seul, sans rien a nettoyer.
 */
export const BEAT_STALE_MS = 3 * 60 * 1000;

/** Periode du battement. Trois fois plus courte que la peremption. */
export const BEAT_PERIOD_MS = 60 * 1000;

/**
 * Delai entre deux tentatives forcees, par nombre de tentatives deja faites.
 *
 * Cinq minutes six fois, puis un quart d'heure. La sentinelle force, donc elle
 * frappe un service tiers deja en difficulte : la surveiller ne justifie pas
 * de la marteler une demi-journee. Une demi-heure d'essais rapproches couvre
 * la panne passagere ; au-dela, c'est une vraie panne et rien ne presse plus.
 */
export const QUICK_ATTEMPTS = 6;
export const QUICK_DELAY_MS = 5 * 60 * 1000;
export const SLOW_DELAY_MS = 15 * 60 * 1000;

export function beatDelay(attempts) {
  const n = Number.isFinite(attempts) && attempts > 0 ? attempts : 0;
  return n < QUICK_ATTEMPTS ? QUICK_DELAY_MS : SLOW_DELAY_MS;
}

/* ------------------------------------------------------------- diagnostic */

/**
 * Les sources en panne repetee, la plus cassee d'abord.
 *
 * `lastSuccess` est rendu tel quel, y compris absent : une source qui n'a
 * jamais reussi et une source qui a cesse de reussir hier ne se traitent pas
 * pareil, et c'est a l'interface de le dire, pas a ce module de le masquer.
 */
export function failingSources(sources, { threshold = FALLBACK_AFTER } = {}) {
  const out = [];
  for (const [name, s] of Object.entries(sources || {})) {
    if (!s || !Number.isFinite(s.consecutiveFailures)) continue;
    if (s.consecutiveFailures < threshold) continue;
    out.push({
      name,
      failures: s.consecutiveFailures,
      lastError: s.lastError || null,
      lastSuccess: Number.isFinite(s.lastSuccess) ? s.lastSuccess : null,
    });
  }
  return out.sort((a, b) => b.failures - a.failures || a.name.localeCompare(b.name));
}

/** Le repli a-t-il lieu d'etre propose ? */
export function shouldOffer(sources, options) {
  return failingSources(sources, options).length > 0;
}

/**
 * Les sources qui sont revenues entre deux etats.
 *
 * Sert a la seule chose qui termine proprement un repli : constater que la
 * veille ordinaire suffit de nouveau, et le dire. Sans ce constat, l'onglet
 * resterait ouvert indefiniment -- et un repli qui ne se referme pas est
 * devenu le mode par defaut, ce que le design refuse.
 */
export function recovered(before, after, options) {
  const avant = new Set(failingSources(before, options).map((s) => s.name));
  const apres = new Set(failingSources(after, options).map((s) => s.name));
  return [...avant].filter((n) => !apres.has(n)).sort();
}

/** Une phrase qui dit ce qui ne va pas, sans jargon et sans mensonge. */
export function reasonText(failing) {
  if (!failing || !failing.length) return null;
  const noms = failing.map((f) => `${f.name} (${f.failures})`).join(', ');
  const motif = failing[0].lastError ? ` -- ${failing[0].lastError}` : '';
  return `${noms}${motif}`;
}

/* -------------------------------------------------------------- battement */

/** Un battement est-il assez frais pour qu'une sentinelle soit reputee active ? */
export function isDriving(beat, now, { staleMs = BEAT_STALE_MS } = {}) {
  if (!beat || !Number.isFinite(beat.at)) return false;
  // Un battement dans le futur est une horloge qui a saute, pas une sentinelle
  // vivante : on le traite comme frais plutot que de faire clignoter l'etat.
  return now - beat.at < staleMs;
}

/* ---------------------------------------------------------------- stockage */

/** Ecrit le battement. Le worker le lit pour savoir qu'un humain surveille. */
export async function writeBeat(chrome, beat) {
  await chrome.storage.local.set({ [KEY_SENTINEL]: beat });
  return beat;
}

/** Lit le battement, ou null s'il n'y en a pas de lisible. */
export async function readBeat(chrome) {
  const brut = await chrome.storage.local.get(KEY_SENTINEL);
  const b = brut[KEY_SENTINEL];
  return b && typeof b === 'object' && Number.isFinite(b.at) ? b : null;
}

/**
 * Efface le battement.
 *
 * Appele a la fermeture de l'onglet, et ce n'est qu'une politesse : la
 * peremption fait le meme travail trois minutes plus tard. Une sentinelle qui
 * disparait brutalement ne doit rien casser.
 */
export async function clearBeat(chrome) {
  await chrome.storage.local.remove(KEY_SENTINEL);
}
