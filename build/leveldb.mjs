/* Lire, sans l'ecrire, le stockage d'une extension dans un profil Chrome.
 *
 * `chrome.storage.local` vit dans une base LevelDB du profil
 * (`Local Extension Settings/<id>/`). Le navigateur la verrouille pendant qu'il
 * tourne, mais ses fichiers se LISENT : c'est tout ce dont l'apercu du popup a
 * besoin pour montrer vos vraies donnees sans recharger l'extension.
 *
 * Deux formats, et le plus recent gagne :
 *
 *   - le journal (`*.log`) : les ecritures recentes, en lots de 32 Ko ;
 *   - les tables (`*.ldb`) : les ecritures compactees, en blocs souvent
 *     compresses en Snappy.
 *
 * Chaque entree porte un numero de sequence ; la valeur d'une cle est celle de
 * sa sequence la plus haute, et une suppression l'efface. Rien ici n'ecrit :
 * aucune fonction de ce module n'ouvre un fichier autrement qu'en lecture.
 *
 * Reference du format : leveldb/doc/log_format.md et table_format.md.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TYPE_DELETION = 0;
const TYPE_VALUE = 1;

/* ------------------------------------------------------------------ outils */

/** Un varint LevelDB, rendu en Number (les tailles et sequences tiennent). */
export function readVarint(buf, offset) {
  let result = 0n;
  let shift = 0n;
  let o = offset;
  for (;;) {
    if (o >= buf.length) throw new Error('varint tronque');
    const byte = buf[o++];
    result |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) break;
    shift += 7n;
    if (shift > 63n) throw new Error('varint trop long');
  }
  return [Number(result), o];
}

/** Decompression Snappy (format brut, sans cadre). */
export function snappyDecompress(src) {
  const [length, start] = readVarint(src, 0);
  const out = Buffer.alloc(length);
  let o = start;
  let op = 0;

  while (o < src.length) {
    const tag = src[o++];
    const kind = tag & 3;

    if (kind === 0) {
      // Litteral. Sa longueur tient dans le tag, ou dans 1 a 4 octets apres.
      let len = tag >> 2;
      if (len >= 60) {
        const bytes = len - 59;
        len = 0;
        for (let i = 0; i < bytes; i++) len |= src[o++] << (8 * i);
      }
      len += 1;
      if (op + len > length || o + len > src.length) throw new Error('snappy : litteral hors bornes');
      src.copy(out, op, o, o + len);
      o += len;
      op += len;
      continue;
    }

    // Copie d'une sequence deja emise.
    let len;
    let dist;
    if (kind === 1) { len = ((tag >> 2) & 7) + 4; dist = ((tag >> 5) << 8) | src[o++]; }
    else if (kind === 2) { len = (tag >> 2) + 1; dist = src.readUInt16LE(o); o += 2; }
    else { len = (tag >> 2) + 1; dist = src.readUInt32LE(o); o += 4; }
    if (!dist || dist > op || op + len > length) throw new Error('snappy : copie hors bornes');
    for (let i = 0; i < len; i++) { out[op] = out[op - dist]; op++; }
  }

  if (op !== length) throw new Error('snappy : longueur annoncee non atteinte');
  return out;
}

/* ----------------------------------------------------------------- journal */

/** Les lots d'ecriture d'un fichier journal, recoupes de leurs fragments. */
function logRecords(buf) {
  const BLOCK = 32768;
  const records = [];
  let fragments = [];
  let off = 0;

  while (off + 7 <= buf.length) {
    const left = BLOCK - (off % BLOCK);
    if (left < 7) { off += left; continue; }
    const len = buf.readUInt16LE(off + 4);
    const type = buf[off + 6];
    if (type === 0 && len === 0) { off += left; continue; } // bourrage
    const data = buf.subarray(off + 7, off + 7 + len);
    off += 7 + len;

    if (type === 1) records.push(Buffer.from(data));             // FULL
    else if (type === 2) fragments = [data];                      // FIRST
    else if (type === 3) fragments.push(data);                    // MIDDLE
    else if (type === 4) {                                        // LAST
      fragments.push(data);
      records.push(Buffer.concat(fragments));
      fragments = [];
    }
  }
  return records;
}

/** Les entrees d'un journal : { key, value (null si supprimee), seq }. */
export function decodeLog(buf) {
  const entries = [];
  for (const r of logRecords(buf)) {
    if (r.length < 12) continue;
    const base = Number(r.readBigUInt64LE(0));
    const count = r.readUInt32LE(8);
    let o = 12;
    for (let i = 0; i < count && o < r.length; i++) {
      const type = r[o++];
      let kl;
      [kl, o] = readVarint(r, o);
      const key = r.subarray(o, o + kl).toString('utf8');
      o += kl;
      let value = null;
      if (type === TYPE_VALUE) {
        let vl;
        [vl, o] = readVarint(r, o);
        value = r.subarray(o, o + vl).toString('utf8');
        o += vl;
      }
      entries.push({ key, value, seq: base + i });
    }
  }
  return entries;
}

/* ------------------------------------------------------------------ tables */

function readBlock(buf, offset, size) {
  const raw = buf.subarray(offset, offset + size);
  const compression = buf[offset + size];
  if (compression === 0) return raw;
  if (compression === 1) return snappyDecompress(raw);
  throw new Error(`table : compression ${compression} inconnue`);
}

function blockEntries(block) {
  const restarts = block.readUInt32LE(block.length - 4);
  const end = block.length - 4 - restarts * 4;
  const out = [];
  let key = Buffer.alloc(0);
  let o = 0;
  while (o < end) {
    let shared;
    let own;
    let vlen;
    [shared, o] = readVarint(block, o);
    [own, o] = readVarint(block, o);
    [vlen, o] = readVarint(block, o);
    key = Buffer.concat([key.subarray(0, shared), block.subarray(o, o + own)]);
    o += own;
    out.push([key, block.subarray(o, o + vlen)]);
    o += vlen;
  }
  return out;
}

/** Les entrees d'une table : { key, value (null si supprimee), seq }. */
export function decodeTable(buf) {
  if (buf.length < 48) throw new Error('table trop courte');
  const footer = buf.subarray(buf.length - 48);
  let o = 0;
  let indexOffset;
  let indexSize;
  [, o] = readVarint(footer, o); // metaindex : inutile ici
  [, o] = readVarint(footer, o);
  [indexOffset, o] = readVarint(footer, o);
  [indexSize] = readVarint(footer, o);

  const entries = [];
  for (const [, handle] of blockEntries(readBlock(buf, indexOffset, indexSize))) {
    let p = 0;
    let off;
    let size;
    [off, p] = readVarint(handle, p);
    [size] = readVarint(handle, p);
    for (const [ikey, value] of blockEntries(readBlock(buf, off, size))) {
      // Cle interne : la cle, puis 8 octets = (sequence << 8) | type.
      const tail = ikey.readBigUInt64LE(ikey.length - 8);
      const type = Number(tail & 0xffn);
      entries.push({
        key: ikey.subarray(0, ikey.length - 8).toString('utf8'),
        value: type === TYPE_DELETION ? null : value.toString('utf8'),
        seq: Number(tail >> 8n),
      });
    }
  }
  return entries;
}

/* -------------------------------------------------------------- dossier */

/**
 * Le contenu courant d'une base : la plus haute sequence de chaque cle, sans
 * les cles supprimees. Les valeurs sont rendues TELLES QUE STOCKEES (du JSON
 * serialise, pour chrome.storage).
 */
export function readDatabase(dir) {
  const latest = new Map();
  const keep = (e) => {
    const prev = latest.get(e.key);
    if (!prev || e.seq >= prev.seq) latest.set(e.key, e);
  };
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (name.endsWith('.log')) decodeLog(readFileSync(file)).forEach(keep);
    else if (name.endsWith('.ldb') || name.endsWith('.sst')) decodeTable(readFileSync(file)).forEach(keep);
  }
  const out = {};
  for (const [k, e] of latest) if (e.value !== null) out[k] = e.value;
  return out;
}

/** chrome.storage serialise chaque valeur en JSON : on la rend telle qu'elle a ete posee. */
export function storageValues(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    try { out[k] = JSON.parse(v); } catch { /* valeur illisible : ignoree */ }
  }
  return out;
}

/* ----------------------------------------------------- trouver l'extension */

/** Les dossiers de donnees utilisateur de Chrome, selon le systeme. */
export function chromeUserDataDirs({ platform = process.platform, env = process.env, home = '' } = {}) {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return [join(local, 'Google', 'Chrome', 'User Data'), join(local, 'Chromium', 'User Data')];
  }
  if (platform === 'darwin') {
    return [join(home, 'Library', 'Application Support', 'Google', 'Chrome'), join(home, 'Library', 'Application Support', 'Chromium')];
  }
  return [join(home, '.config', 'google-chrome'), join(home, '.config', 'chromium')];
}

/**
 * Les bases d'extensions qui portent les cles de celle-ci, la plus recemment
 * ecrite d'abord. Une ancienne installation (autre identifiant) peut rester
 * dans le profil : c'est la plus fraiche qui interesse.
 */
export function findExtensionDatabases(userDataDirs) {
  const found = [];
  for (const root of userDataDirs) {
    if (!existsSync(root)) continue;
    for (const profile of readdirSync(root)) {
      const settings = join(root, profile, 'Local Extension Settings');
      if (!existsSync(settings)) continue;
      for (const id of readdirSync(settings)) {
        const dir = join(settings, id);
        try {
          const keys = Object.keys(readDatabase(dir));
          if (!keys.some((k) => k.startsWith('veille:') || k.startsWith('FGC_history_'))) continue;
          const mtime = Math.max(...readdirSync(dir).map((f) => statSync(join(dir, f)).mtimeMs));
          found.push({ dir, profile, id, mtime });
        } catch { /* base illisible ou d'une autre extension : ignoree */ }
      }
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime);
}
