/* Tokeniseur JavaScript minimal, juste assez pour renommer des identifiants.
 *
 * Il n'y a pas d'arbre syntaxique ici et il n'en faut pas : la seule question
 * posee est « ce mot est-il un identifiant, ou du texte ? ». Ce qui compte,
 * c'est de ne jamais se tromper sur les quatre contextes ou un mot n'est PAS un
 * identifiant : commentaire, chaine, litteral d'expression reguliere, et texte
 * de gabarit -- sachant que les ${...} d'un gabarit, eux, sont du code.
 *
 * Invariant teste : scan(src, () => undefined) rend src octet pour octet. Un
 * tokeniseur qui perd un caractere perd du code, et un renommage silencieusement
 * tronque est bien pire qu'un renommage refuse.
 */

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

/* Un / ouvre une expression reguliere quand une VALEUR est attendue, et une
   division quand une valeur vient d'etre lue. Le dernier jeton significatif
   tranche ; ces mots-cles sont ceux apres lesquels une valeur est attendue. */
const BEFORE_REGEX = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw',
]);

/**
 * Parcourt `src` et appelle `onIdent(mot, ctx)` sur chaque jeton identifiant.
 *
 * `ctx.member` : le mot suit un point, c'est un acces a une propriete.
 * `ctx.key`    : le mot precede un deux-points, c'est une cle d'objet litteral.
 *
 * Ce que `onIdent` rend remplace le mot ; `undefined` le laisse tel quel.
 */
export function scan(src, onIdent) {
  let out = '';
  let i = 0;
  const n = src.length;

  /* Pile des gabarits. Chaque entree compte les accolades ouvertes dans le
     ${...} courant : a zero on est dans du texte, au-dessus dans du code. Une
     pile et non un booleen, parce qu'un gabarit peut en contenir un autre. */
  const templates = [];
  let last = null;

  const valueExpected = () => {
    if (last === null) return true;
    if (last.type === 'ident') return BEFORE_REGEX.has(last.value);
    if (last.type === 'punct') return !/^[)\]}]$/.test(last.value);
    return false;                                       // nombre, chaine, regex
  };

  while (i < n) {
    const top = templates.length ? templates[templates.length - 1] : null;

    /* --- texte de gabarit : d'abord, parce que rien d'autre ne s'y applique.
       Une apostrophe dans « il n'y a rien » n'ouvre pas une chaine. */
    if (top && top.depth === 0) {
      let j = i;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '`') break;
        if (src[j] === '$' && src[j + 1] === '{') break;
        j++;
      }
      out += src.slice(i, j);
      i = j;
      if (i >= n) break;
      if (src[i] === '`') {
        out += '`';
        i++;
        templates.pop();
        last = { type: 'string', value: '' };
      } else {
        out += '${';
        i += 2;
        top.depth = 1;
        last = { type: 'punct', value: '{' };
      }
      continue;
    }

    const c = src[i];
    const d = src[i + 1];

    /* --- commentaires */
    if (c === '/' && d === '/') {
      const j = src.indexOf('\n', i);
      const end = j === -1 ? n : j;
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (c === '/' && d === '*') {
      const j = src.indexOf('*/', i + 2);
      const end = j === -1 ? n : j + 2;
      out += src.slice(i, end);
      i = end;
      continue;
    }

    /* --- chaines */
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++;
        j++;
      }
      out += src.slice(i, Math.min(j + 1, n));
      i = j + 1;
      last = { type: 'string', value: '' };
      continue;
    }

    /* --- ouverture de gabarit */
    if (c === '`') {
      out += c;
      i++;
      templates.push({ depth: 0 });
      last = null;
      continue;
    }

    /* --- expression reguliere */
    if (c === '/' && valueExpected()) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const ch = src[j];
        if (ch === '\\') { j += 2; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '\n') break;                  // pas une regex, en fait
        else if (ch === '/' && !inClass) { closed = true; break; }
        j++;
      }
      if (closed) {
        let k = j + 1;
        while (k < n && /[a-z]/.test(src[k])) k++;
        out += src.slice(i, k);
        i = k;
        last = { type: 'regex', value: '' };
        continue;
      }
      // Pas de fermeture sur la ligne : c'etait une division.
    }

    /* --- identifiants */
    if (IDENT_START.test(c)) {
      let j = i;
      while (j < n && IDENT_PART.test(src[j])) j++;
      const word = src.slice(i, j);

      /* Un mot precede d'un point est une propriete, suivi d'un deux-points une
         cle d'objet litteral. Ni l'un ni l'autre n'est une liaison : un `title`
         local coexiste sans peine avec un `objet.title`. Le double deux-points
         n'existe pas en JavaScript, mais l'operateur ternaire produit `? a : b`
         ou `a` n'est pas une cle -- d'ou la verification du caractere suivant.  */
      let k = j;
      while (k < n && /\s/.test(src[k])) k++;
      const replacement = onIdent(word, {
        member: last !== null && last.type === 'punct' && last.value === '.',
        key: src[k] === ':' && src[k + 1] !== ':',
      });

      out += replacement === undefined ? word : replacement;
      i = j;
      last = { type: 'ident', value: word };
      continue;
    }

    /* --- nombres */
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[0-9a-fA-FxXoObBeE._]/.test(src[j])) j++;
      out += src.slice(i, j);
      i = j;
      last = { type: 'number', value: '' };
      continue;
    }

    /* --- ponctuation, avec suivi des accolades pour les gabarits */
    if (top && top.depth > 0) {
      if (c === '{') top.depth++;
      else if (c === '}') {
        top.depth--;
        if (top.depth === 0) {
          out += '}';
          i++;
          last = { type: 'string', value: '' };
          continue;
        }
      }
    }
    out += c;
    if (!/\s/.test(c)) last = { type: 'punct', value: c };
    i++;
  }

  return out;
}

/** Remplace les identifiants presents dans `map`. */
export function renameIdentifiers(src, map) {
  return scan(src, (word) => (Object.prototype.hasOwnProperty.call(map, word) ? map[word] : undefined));
}

/** Identifiants LIBRES : ni proprietes, ni cles d'objet litteral. */
export function freeIdentifiers(src) {
  const seen = new Set();
  scan(src, (word, ctx) => {
    if (!ctx.member && !ctx.key) seen.add(word);
    return undefined;
  });
  return seen;
}

/** Vrai si le tokeniseur rend le source inchange -- l'invariant a tenir. */
export function roundTrips(src) {
  return scan(src, () => undefined) === src;
}
