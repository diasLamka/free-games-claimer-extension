/* La jaquette du jeu dans la notification (2.63.0).
 *
 * Une notification disait « Gratuit : Mindcop -- Gratuit sur Epic Games
 * Store », a cote de l'icone de l'extension. C'est pourtant par elle qu'on
 * apprend qu'un jeu est offert : l'image du jeu dit en un coup d'oeil ce que
 * le titre dit en une lecture.
 *
 * Chrome n'accepte dans une notification qu'une image de l'extension, une
 * adresse `data:` ou `blob:` -- jamais une adresse distante. Le worker
 * telecharge donc la jaquette, la recadre en 2:1, la reduit et la passe en
 * `data:`. Mesure du 2026-09-24 : les CDN d'images de Steam, Epic et GOG
 * repondent `access-control-allow-origin: *`, et celui de GamerPower est deja
 * couvert par les permissions. Une vignette Epic pese pres d'1 Mo en
 * 2560 x 1440 : reduite a 720 x 360 en JPEG, une cinquantaine de Ko.
 *
 * Tout echec vaut « pas d'image » : la notification part quand meme, avec
 * l'icone. Une image n'est jamais une raison de ne pas prevenir.
 *
 * Sans cookies, sans referent, en https seulement, bornee en taille et en
 * temps. Module sans etat : ce qu'il touche de la plateforme lui est passe.
 */

/** Le format de l'image : 2:1, celui que Windows montre en grand. */
export const IMAGE_W = 720;
export const IMAGE_H = 360;
/** Au-dela, on ne telecharge pas : une jaquette n'a pas a peser plus. */
export const MAX_BYTES = 4 * 1024 * 1024;
export const TIMEOUT_MS = 5000;

/**
 * Le recadrage « cover » : la plus grande zone de la source au format de la
 * cible, centree. Rien n'est deforme ; ce qui depasse est coupe.
 */
export function coverCrop(sw, sh, dw = IMAGE_W, dh = IMAGE_H) {
  if (!(sw > 0 && sh > 0 && dw > 0 && dh > 0)) return null;
  const cible = dw / dh;
  if (sw / sh > cible) {
    const w = Math.round(sh * cible);
    return { sx: Math.round((sw - w) / 2), sy: 0, sw: w, sh };
  }
  const h = Math.round(sw / cible);
  return { sx: 0, sy: Math.round((sh - h) / 2), sw, sh: h };
}

/** Des octets en base64, par tranches : `String.fromCharCode(...grand)` deborde la pile. */
export function toBase64(bytes, btoaImpl = globalThis.btoa) {
  let bin = '';
  const PAS = 0x8000;
  for (let i = 0; i < bytes.length; i += PAS) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + PAS));
  }
  return btoaImpl(bin);
}

/**
 * La jaquette `url`, prete pour une notification : une adresse `data:`, ou
 * null.
 *
 * `createImageBitmap` et `OffscreenCanvas` servent a la reduire ; sans eux,
 * une image deja legere (moins de 300 Ko) passe telle quelle, une lourde non.
 */
export async function notificationImage(url, {
  fetch: fetchImpl = globalThis.fetch,
  createImageBitmap: bitmap = globalThis.createImageBitmap,
  OffscreenCanvas: Canvas = globalThis.OffscreenCanvas,
  btoa: btoaImpl = globalThis.btoa,
  timeoutMs = TIMEOUT_MS,
} = {}) {
  if (typeof url !== 'string' || !/^https:\/\/[^\s"'<>]{1,2000}$/.test(url) || typeof fetchImpl !== 'function') return null;
  const arret = typeof AbortController === 'function' ? new AbortController() : null;
  const minuterie = arret ? setTimeout(() => arret.abort(), timeoutMs) : null;
  try {
    const r = await fetchImpl(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'force-cache',
      signal: arret ? arret.signal : undefined,
    });
    if (!r || !r.ok) return null;
    const type = String((r.headers && r.headers.get && r.headers.get('content-type')) || '').split(';')[0].trim();
    if (!/^image\/(jpeg|png|webp|gif|avif)$/i.test(type)) return null;
    const annonce = Number(r.headers.get('content-length'));
    if (Number.isFinite(annonce) && annonce > MAX_BYTES) return null;
    const blob = await r.blob();
    if (!blob || blob.size > MAX_BYTES) return null;

    if (typeof bitmap === 'function' && typeof Canvas === 'function') {
      const img = await bitmap(blob);
      try {
        const zone = coverCrop(img.width, img.height);
        if (!zone) return null;
        const toile = new Canvas(IMAGE_W, IMAGE_H);
        const ctx = toile.getContext('2d');
        ctx.drawImage(img, zone.sx, zone.sy, zone.sw, zone.sh, 0, 0, IMAGE_W, IMAGE_H);
        const petit = await toile.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
        return `data:image/jpeg;base64,${toBase64(new Uint8Array(await petit.arrayBuffer()), btoaImpl)}`;
      } finally {
        if (img && typeof img.close === 'function') img.close();
      }
    }
    if (blob.size > 300 * 1024) return null;
    return `data:${type};base64,${toBase64(new Uint8Array(await blob.arrayBuffer()), btoaImpl)}`;
  } catch {
    return null;
  } finally {
    if (minuterie) clearTimeout(minuterie);
  }
}
