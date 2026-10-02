/* Le carnet : un journal des jeux pris, dont on voit si on l'a modifie (2.105.0).
 *
 * Chaque jeu pris ajoute une ligne au carnet, et chaque ligne porte l'EMPREINTE
 * (SHA-256) de la precedente : changer un titre, une date ou une valeur, retirer
 * une ligne du milieu, en inserer une ou en echanger deux casse la chaine, et
 * `verifyLedger` dit a quelle ligne.
 *
 * CE QUE C'EST -- ET CE QUE CE N'EST PAS. C'est MON journal : il dit « l'extension
 * a note ceci, a cette date ». Ce n'est PAS un recu signe par un magasin : rien ici
 * ne prouve a un tiers que le magasin vous a donne le jeu, et quelqu'un qui tient
 * votre disque pourrait refaire tout le carnet d'un coup. Il sert a VOUS : savoir
 * que rien n'a ete modifie ni retire depuis, a condition de garder l'empreinte de
 * tete (`head`) ailleurs -- sans elle, retirer les DERNIERES lignes ne se voit pas.
 *
 * Plafond : 5000 lignes. Au-dela, les plus anciennes sortent et `base` garde
 * l'empreinte de la derniere sortie : la chaine restante se verifie toujours.
 *
 * Module pur, sauf `sha256Hex` qui recoit `crypto.subtle` (celui du navigateur ou
 * de Node). L'instant est toujours passe en parametre.
 */

/** Le carnet, dans le stockage. Ecrit par le worker seul. */
export const KEY_LEDGER = 'veille:carnet';

export const GENESIS = '0'.repeat(64);
export const MAX_ENTRIES = 5000;
export const KEEP_ENTRIES = 4000;

/** Les statuts qui valent « le jeu est a moi » -- les memes que le registre. */
export const KINDS = Object.freeze({ TAKEN: 'taken', ALREADY: 'already' });

const HEX64 = /^[0-9a-f]{64}$/;

export function emptyLedger() {
  return { base: GENESIS, baseN: 0, entries: [], head: GENESIS };
}

const texte = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);

/** Un carnet lu du stockage, rendu exploitable quoi qu'il contienne. Ne verifie PAS la chaine. */
export function readLedger(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const entries = Array.isArray(r.entries) ? r.entries.filter((e) => e && typeof e === 'object' && Number.isInteger(e.n) && typeof e.hash === 'string') : [];
  const base = typeof r.base === 'string' && HEX64.test(r.base) ? r.base : GENESIS;
  const baseN = Number.isInteger(r.baseN) && r.baseN >= 0 ? r.baseN : 0;
  const head = entries.length ? entries[entries.length - 1].hash : base;
  return { base, baseN, entries, head };
}

/** Le texte que l'empreinte couvre : un tableau, pour qu'aucun ordre de cles ne compte. */
export function payload(e) {
  return JSON.stringify([e.n, e.ts, e.store, e.id, e.title, e.status, e.kind, e.worth, e.wsrc]);
}

export async function sha256Hex(text, subtle = globalThis.crypto && globalThis.crypto.subtle) {
  const bytes = new TextEncoder().encode(String(text));
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const hashOf = (prev, e, subtle) => sha256Hex(`${prev}\n${payload(e)}`, subtle);

/** Ce qu'on garde d'un jeu pris. Volontairement peu, et jamais un code ni une adresse de compte. */
function clean(item, n) {
  return {
    n,
    ts: Number.isFinite(item.ts) ? item.ts : 0,
    store: texte(item.store, 32) || '?',
    id: texte(item.id, 160) || '',
    title: texte(item.title, 160),
    status: texte(item.status, 32) || 'claimed',
    kind: item.kind === KINDS.ALREADY ? KINDS.ALREADY : KINDS.TAKEN,
    worth: texte(item.worth, 40),
    wsrc: item.wsrc === 'store' || item.wsrc === 'aggregator' ? item.wsrc : null,
  };
}

/**
 * Ajoute des lignes. Un jeu deja note (meme magasin, meme identifiant, meme genre)
 * n'est pas note deux fois. Rend le carnet suivant et ce qui a ete ajoute.
 */
export async function appendEntries(ledger, items, { subtle } = {}) {
  const l = readLedger(ledger);
  const deja = new Set(l.entries.map((e) => `${e.store}|${e.id}|${e.kind}`));
  let prev = l.head;
  let n = l.baseN + l.entries.length;
  const added = [];
  for (const it of items || []) {
    if (!it || typeof it !== 'object') continue;
    const e = clean(it, n + 1);
    const cle = `${e.store}|${e.id}|${e.kind}`;
    if (!e.id || deja.has(cle)) continue;
    e.prev = prev;
    e.hash = await hashOf(prev, e, subtle);
    deja.add(cle);
    prev = e.hash;
    n += 1;
    added.push(e);
  }
  if (!added.length) return { ledger: l, added };
  let entries = [...l.entries, ...added];
  let base = l.base;
  let baseN = l.baseN;
  if (entries.length > MAX_ENTRIES) {
    const sortent = entries.slice(0, entries.length - KEEP_ENTRIES);
    base = sortent[sortent.length - 1].hash;
    baseN += sortent.length;
    entries = entries.slice(sortent.length);
  }
  return { ledger: { base, baseN, entries, head: entries[entries.length - 1].hash }, added };
}

/**
 * Relit toute la chaine. Rend { ok, count, head, badAt, reason } : `badAt` est le
 * numero de la premiere ligne qui ne tient plus, `reason` dit pourquoi
 * ('hash' : modifiee ; 'prev' : sa voisine a change ; 'n' : numerotation ; 'head' : la tete annoncee).
 */
export async function verifyLedger(ledger, { subtle, expectedHead = null } = {}) {
  const l = readLedger(ledger);
  let prev = l.base;
  let n = l.baseN;
  for (const e of l.entries) {
    n += 1;
    if (e.n !== n) return { ok: false, count: l.entries.length, head: l.head, badAt: e.n, reason: 'n' };
    if (e.prev !== prev) return { ok: false, count: l.entries.length, head: l.head, badAt: e.n, reason: 'prev' };
    const attendu = await hashOf(prev, e, subtle);
    if (attendu !== e.hash) return { ok: false, count: l.entries.length, head: l.head, badAt: e.n, reason: 'hash' };
    prev = e.hash;
  }
  if (expectedHead && expectedHead !== l.head) return { ok: false, count: l.entries.length, head: l.head, badAt: null, reason: 'head' };
  return { ok: true, count: l.entries.length, head: l.head, badAt: null, reason: null };
}

/** Les douze premiers caracteres de l'empreinte de tete : de quoi la noter. */
export function shortHead(head) {
  return typeof head === 'string' && HEX64.test(head) && head !== GENESIS ? head.slice(0, 12) : '';
}

/** Le fichier d'export : le carnet entier et son empreinte de tete, relisible tel quel par `verifyLedger`. */
export function exportLedger(ledger, { now, version = null } = {}) {
  const l = readLedger(ledger);
  return {
    format: 'fgc-carnet-1',
    exportedAt: new Date(now).toISOString(),
    extensionVersion: version,
    note: 'Journal tenu par l\'extension : il montre que rien n\'a ete modifie depuis. Ce n\'est pas un recu signe par un magasin.',
    base: l.base,
    baseN: l.baseN,
    head: l.head,
    count: l.entries.length,
    entries: l.entries,
  };
}

/** Un fichier d'export, relu : null s'il n'est pas de ce format. */
export function readExport(data) {
  if (!data || typeof data !== 'object' || data.format !== 'fgc-carnet-1') return null;
  const l = readLedger(data);
  return { ledger: l, declaredHead: typeof data.head === 'string' ? data.head : null };
}

/** La fusion d'une sauvegarde : le carnet le plus long gagne, le local en cas d'egalite. */
export function mergeLedger(local, fichier) {
  const a = readLedger(local);
  const b = readLedger(fichier);
  const taille = (l) => l.baseN + l.entries.length;
  return taille(b) > taille(a) ? { value: b, added: taille(b) - taille(a) } : { value: a, added: 0 };
}

/**
 * Les jeux qui viennent d'entrer au registre, en lignes de carnet. `touched` :
 * [{ key, entry, isNew, already }] tel que integrateHistory le rend -- seuls les
 * NOUVEAUX comptent, un enrichissement n'est pas une prise.
 */
export function itemsFromTouched(touched) {
  return (touched || []).filter((t) => t && t.isNew && t.entry).map((t) => ({
    ts: t.entry.ts,
    store: t.entry.store,
    id: t.entry.id,
    title: t.entry.title,
    status: t.entry.status,
    kind: t.already ? KINDS.ALREADY : KINDS.TAKEN,
    worth: t.entry.worth,
    wsrc: t.entry.wsrc,
  }));
}
