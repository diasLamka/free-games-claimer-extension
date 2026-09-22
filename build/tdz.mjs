/* Detecte une liaison de haut niveau lue AVANT sa ligne de declaration.
 *
 * Pourquoi ce controle existe.
 *
 * En 2.36.0, `KEY_SEEN` a ete ajoutee a la liste KEYS_READ de popup.js, mais
 * declaree seize lignes plus bas. Une `const` lue avant sa declaration leve
 * « Cannot access 'KEY_SEEN' before initialization » au CHARGEMENT du module :
 * aucune ligne de popup.js ne s'executait plus, et le popup restait vide --
 * quatre versions durant. undefined-refs.mjs ne pouvait rien y voir : le nom
 * existait bien, simplement trop tard.
 *
 * Methode. On retire commentaires, chaines, gabarits et expressions regulieres,
 * puis on suit la profondeur d'accolades. Seul le code a profondeur zero
 * s'execute au chargement ; un usage dans un corps de fonction est sans risque,
 * puisqu'il ne s'execute qu'apres. Une instruction de haut niveau qui contient
 * une fleche ou le mot `function` avant l'usage est ignoree : l'usage vit dans
 * un corps differe.
 *
 * Volontairement approximatif dans un seul sens : en cas de doute, on se tait.
 */
import { readFileSync } from 'node:fs';

const REGEX_BEFORE = /[=(,:[!&|?{};+\-*%<>~^]$/;

/** Le source, commentaires/chaines/regex remplaces par des espaces (lignes gardees). */
export function codeOnly(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let lastSignificant = '';
  const blank = (s) => s.replace(/[^\n]/g, ' ');

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const j = src.indexOf('\n', i);
      const end = j === -1 ? n : j;
      out += blank(src.slice(i, end)); i = end; continue;
    }
    if (c === '/' && d === '*') {
      const j = src.indexOf('*/', i + 2);
      const end = j === -1 ? n : j + 2;
      out += blank(src.slice(i, end)); i = end; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      out += c + blank(src.slice(i + 1, j)) + c; i = j + 1; lastSignificant = c; continue;
    }
    if (c === '/' && (lastSignificant === '' || REGEX_BEFORE.test(lastSignificant) || /\b(return|typeof|case)$/.test(out.trimEnd()))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      out += '/' + blank(src.slice(i + 1, j)) + '/'; i = j + 1; lastSignificant = '/'; continue;
    }
    out += c;
    if (!/\s/.test(c)) lastSignificant = c;
    i++;
  }
  return out;
}

/** Les usages de haut niveau qui precedent la declaration du meme nom. */
export function useBeforeDeclaration(fichier) {
  const code = codeOnly(readFileSync(fichier, 'utf8'));
  const lignes = code.split('\n');

  // Declarations de haut niveau : en colonne zero, hors de toute accolade.
  const decl = new Map();
  let depth = 0;
  lignes.forEach((ligne, idx) => {
    const m = depth === 0 && /^(?:export\s+)?(?:const|let|class)\s+([A-Za-z_$][\w$]*)/.exec(ligne);
    if (m && !decl.has(m[1])) decl.set(m[1], idx + 1);
    for (const ch of ligne) { if (ch === '{') depth++; else if (ch === '}') depth--; }
  });

  const trouves = [];
  depth = 0;
  let differe = false;            // l'instruction courante ouvre un corps differe
  lignes.forEach((ligne, idx) => {
    const numero = idx + 1;
    const re = /[A-Za-z_$][\w$]*|=>|[{};]/g;
    let m;
    while ((m = re.exec(ligne))) {
      const tok = m[0];
      if (tok === '{') { depth++; continue; }
      if (tok === '}') { depth--; if (depth === 0) differe = false; continue; }
      if (depth !== 0) continue;
      if (tok === ';') { differe = false; continue; }
      if (tok === '=>' || tok === 'function' || tok === 'class') { differe = true; continue; }
      if (differe) continue;
      const avant = ligne[m.index - 1];
      if (avant === '.') continue;                                   // propriete
      if (/^\s*:/.test(ligne.slice(m.index + tok.length))) continue; // cle d'objet
      const ou = decl.get(tok);
      if (ou && numero < ou) trouves.push({ mot: tok, ligne: numero, declaration: ou });
    }
    // Une ligne vide a profondeur zero clot l'instruction : sans point-virgule
    // obligatoire, c'est la meilleure frontiere disponible.
    if (depth === 0 && !ligne.trim()) differe = false;
  });
  return trouves;
}
