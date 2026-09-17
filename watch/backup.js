/* Les codes en attente, mis a l'abri.
 *
 * watch/tally.js le dit depuis la V2, et rien n'avait suivi : « un code GOG
 * perdu est un jeu perdu, et rien ne les sauvegarde aujourd'hui -- ni git, ni
 * synchronisation. Une desinstallation les emporte. » L'export manuel existe,
 * et il suppose qu'on y pense AVANT, ce qui est exactement ce qu'on ne fait
 * pas.
 *
 * Ce module met les codes -- eux seuls -- dans `chrome.storage.sync`, que le
 * navigateur replique sur le compte de l'utilisateur. Le reste ne suit pas :
 * le catalogue se reconstruit en un cycle de veille, l'historique se recompte,
 * et les faire voyager mangerait les 100 Ko de la zone pour des donnees
 * remplacables. Un code, lui, n'existe qu'a un seul endroit au monde.
 *
 * TROIS CONTRAINTES DE LA ZONE SYNC, qui faconnent tout ce fichier :
 *
 *   8 Ko PAR ELEMENT. Au-dela, `set()` REJETTE -- il ne tronque pas. Un lot de
 *   codes trop gros ne serait donc pas « partiellement sauvegarde » : il ne
 *   serait pas sauvegarde du tout, en silence. D'ou `packForSync`, qui coupe
 *   ici plutot que de laisser le navigateur refuser la-bas.
 *
 *   ELLE PEUT NE PAS EXISTER. Un profil sans compte, une politique
 *   d'entreprise, un Firefox temporaire : `chrome.storage.sync` est alors
 *   absent ou jette. Rien de ce qui suit ne doit faire tomber un cycle pour
 *   autant -- la sauvegarde est un filet, pas une fonction vitale.
 *
 *   ELLE TRAVERSE UN COMPTE. C'est pour cela que le miroir est un REGLAGE, et
 *   par defaut coupe. Poser les codes d'un utilisateur chez Google sans le lui
 *   demander ne serait pas une commodite, ce serait une decision prise a sa
 *   place.
 *
 * Les fonctions de decision sont pures ; celles qui touchent au stockage
 * recoivent leur `chrome` en parametre, comme watch/commands.js.
 */

/** Cle DANS LA ZONE SYNC. Meme espace de nommage que le reste de la veille. */
export const KEY_SYNC_CODES = 'veille:codes-sauvegarde';

/** La cle du moteur, dans la zone locale. C'est lui qui l'ecrit. */
export const KEY_CODES = 'FGC_pending_codes';

/**
 * QUOTA_BYTES_PER_ITEM, moins une marge.
 *
 * La marge n'est pas de la superstition : le quota compte la cle PLUS la
 * valeur serialisee, et la mesure exacte du navigateur nous echappe. Coincer
 * la sauvegarde a un octet pres serait la perdre entierement.
 */
export const MAX_ITEM_BYTES = 7800;

/* ------------------------------------------------------------------ lecture */

/**
 * Lit la liste des codes, quelle que soit la forme sous laquelle elle arrive.
 *
 * Le moteur l'ecrit en JSON serialise (GM_setValue), la zone sync la rend en
 * tableau. Les deux passent ici, et tout ce qui n'est ni l'un ni l'autre rend
 * un tableau vide plutot qu'une exception dans un service worker.
 */
export function parseCodes(raw) {
  if (Array.isArray(raw)) return raw.filter((c) => c && typeof c.code === 'string');
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((c) => c && typeof c.code === 'string') : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ fusion */

/** Combien de champs renseignes porte une entree. Sert a departager. */
function richness(entry) {
  return Object.values(entry || {}).filter((v) => v !== null && v !== undefined && v !== '').length;
}

/**
 * Fusionne deux listes de codes, sans jamais en perdre un.
 *
 * La cle est le CODE lui-meme : c'est la seule chose qui l'identifie, et deux
 * entrees qui le portent designent le meme jeu. Quand les deux existent, on
 * garde la plus renseignee -- une entree restauree qui aurait perdu son titre
 * ne doit pas ecraser celle qui l'a encore.
 *
 * L'ordre suit `base` puis les nouveaux venus : le plus ancien reste en tete,
 * comme le moteur les ecrit.
 */
export function mergeCodes(base, incoming) {
  const out = [];
  const index = new Map();

  for (const entry of [...parseCodes(base), ...parseCodes(incoming)]) {
    const vu = index.get(entry.code);
    if (vu === undefined) {
      index.set(entry.code, out.length);
      out.push(entry);
      continue;
    }
    if (richness(entry) > richness(out[vu])) out[vu] = { ...out[vu], ...entry };
  }
  return out;
}

/* --------------------------------------------------------------- emballage */

/** Taille que la zone sync comptera pour ce lot. */
export function sizeOf(codes) {
  return KEY_SYNC_CODES.length + JSON.stringify(codes).length;
}

/**
 * Ce qui tient dans un element de la zone sync, et ce qui reste dehors.
 *
 * On coupe par les PLUS ANCIENS. Le moteur ajoute a la fin : la queue de la
 * liste est donc ce qui vient d'arriver, c'est-a-dire ce qui n'a pas encore
 * ete echange et dont la perte couterait le plus. Couper par la fin
 * sauvegarderait exactement les codes dont on n'a plus besoin.
 *
 * Rendre `dropped` n'est pas cosmetique : une sauvegarde partielle qui se
 * croit complete est pire que pas de sauvegarde du tout, et l'interface doit
 * pouvoir le dire.
 */
export function packForSync(codes, { maxBytes = MAX_ITEM_BYTES } = {}) {
  const liste = parseCodes(codes);
  if (sizeOf(liste) <= maxBytes) return { kept: liste, dropped: [] };

  let debut = 0;
  while (debut < liste.length && sizeOf(liste.slice(debut)) > maxBytes) debut++;

  return { kept: liste.slice(debut), dropped: liste.slice(0, debut) };
}

/* ---------------------------------------------------------------- stockage */

/** La zone sync existe-t-elle vraiment ici ? */
export function hasSync(chrome) {
  return Boolean(chrome && chrome.storage && chrome.storage.sync);
}

/**
 * Ecrit le miroir. Ne jette jamais : un filet qui casse ne doit pas emporter
 * ce qu'il protege.
 */
export async function mirrorCodes(chrome, codes) {
  if (!hasSync(chrome)) return { mirrored: 0, dropped: 0, ok: false };

  const { kept, dropped } = packForSync(codes);
  try {
    await chrome.storage.sync.set({ [KEY_SYNC_CODES]: kept });
    return { mirrored: kept.length, dropped: dropped.length, ok: true };
  } catch {
    // Quota global, hors ligne, sync desactivee par une politique.
    return { mirrored: 0, dropped: dropped.length, ok: false };
  }
}

/** Ce que la zone sync garde, ou un tableau vide si elle ne repond pas. */
export async function readMirror(chrome) {
  if (!hasSync(chrome)) return [];
  try {
    const raw = await chrome.storage.sync.get(KEY_SYNC_CODES);
    return parseCodes(raw[KEY_SYNC_CODES]);
  } catch {
    return [];
  }
}

/**
 * Remet dans la zone locale les codes que seule la sauvegarde connait.
 *
 * FUSION, jamais remplacement. Une restauration qui ecraserait la liste locale
 * effacerait les codes recoltes depuis la derniere synchronisation -- soit
 * exactement le scenario ou l'on croit sauver ses donnees et ou on les perd.
 *
 * Rend le nombre d'entrees REELLEMENT ajoutees : zero est le cas normal, et il
 * ne doit rien ecrire du tout.
 */
export async function restoreCodes(chrome) {
  const mirror = await readMirror(chrome);
  if (!mirror.length) return { restored: 0 };

  const brut = await chrome.storage.local.get(KEY_CODES);
  const local = parseCodes(brut[KEY_CODES]);
  const fusion = mergeCodes(local, mirror);

  if (fusion.length === local.length) return { restored: 0 };

  // Le moteur lit cette cle en JSON serialise (GM_getValue) : la rendre sous
  // une autre forme la rendrait illisible pour lui.
  await chrome.storage.local.set({ [KEY_CODES]: JSON.stringify(fusion) });
  return { restored: fusion.length - local.length };
}
