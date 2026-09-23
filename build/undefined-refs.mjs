/* Detecte les references a un nom qui n'existe pas.
 *
 * Pourquoi ce controle existe.
 *
 * `node --check` valide la SYNTAXE, pas les references : un appel a une fonction
 * qui n'a jamais ete definie passe le controle, passe le build, passe le
 * deploiement, et casse a l'execution. En 2.12.0 un renommage a transforme
 * `sinceText` en `since` dans popup.js ; du code ecrit apres appelait encore
 * l'ancien nom. Resultat en production : « ReferenceError: sinceText is not
 * defined », leve au MILIEU du rendu de la liste des jeux -- donc plus aucun
 * jeu, plus aucune vignette, et un popup a moitie vide sans explication.
 *
 * Une erreur de reference ne se voit pas en relisant : elle se voit quand le
 * navigateur la leve. C'est exactement le genre de faute qu'un controle statique
 * doit attraper, et exactement celui que les tests unitaires ne couvrent pas --
 * ils ne chargent pas popup.js, qui a besoin d'un DOM.
 *
 * Methode. On collecte tout ce qui est DECLARE (fonctions, const/let/var,
 * parametres, destructuration, imports, labels de boucle) et tout ce qui est
 * REFERENCE librement, puis on soustrait. Le reste doit etre un global connu.
 *
 * Volontairement approximatif dans un seul sens : en cas de doute, on se TAIT.
 * Un controle qui crie au loup est un controle qu'on desactive.
 */
import { readFileSync } from 'node:fs';
import { scan } from './tokenizer.mjs';

/* Globals du navigateur et de la plateforme que le code a le droit d'utiliser
   sans les declarer. Enumeres plutot que devines : une liste trop large laisse
   passer la faute qu'on cherche. */
const GLOBALS = new Set(`
  globalThis window document navigator location history screen console
  chrome browser
  Object Array String Number Boolean Symbol BigInt Math JSON Date RegExp Error
  TypeError RangeError SyntaxError ReferenceError EvalError URIError
  Promise Map Set WeakMap WeakSet Proxy Reflect Intl
  ArrayBuffer DataView Uint8Array Uint16Array Uint32Array Int8Array Int16Array Int32Array Float32Array Float64Array
  Function Infinity NaN undefined null true false
  parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent
  encodeURI decodeURI structuredClone queueMicrotask
  setTimeout clearTimeout setInterval clearInterval requestAnimationFrame
  fetch Request Response Headers AbortController AbortSignal
  Blob File FileReader FormData URL URLSearchParams TextEncoder TextDecoder
  Event CustomEvent EventTarget MutationObserver IntersectionObserver
  Node Element HTMLElement DocumentFragment DOMParser XMLSerializer
  Image Audio Worker BroadcastChannel MessageChannel
  crypto performance localStorage sessionStorage indexedDB caches
  alert confirm prompt atob btoa
  self top parent frames closed
  arguments this super new import export
  let const var function class return if else for while do switch case break
  continue typeof instanceof in of delete void throw try catch finally
  async await yield static get set extends default from as with debugger
`.trim().split(/\s+/));

/* --- ce qui est declare ------------------------------------------------------ */

/**
 * Noms lies dans le fichier.
 *
 * Une seule passe d'expressions regulieres sur le source DEBARRASSE de ses
 * commentaires et de ses chaines -- c'est le tokeniseur qui s'en charge, en
 * remplacant chaque identifiant par lui-meme et en laissant tomber le reste.
 */
function declared(src) {
  const noms = new Set();
  const ajoute = (liste) => {
    for (const brut of String(liste).split(/[,\s]+/)) {
      // Retire les valeurs par defaut, le rest, les alias de destructuration.
      const m = /^\.{0,3}\s*([A-Za-z_$][\w$]*)/.exec(brut.trim());
      if (m) noms.add(m[1]);
    }
  };

  const motifs = [
    // declarations nommees
    [/\b(?:function\s*\*?|class)\s+([A-Za-z_$][\w$]*)/g, 1],
    [/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g, 1],
    // parametres : function f(a, b), (a, b) =>, catch (e)
    [/\bfunction\s*\*?\s*[A-Za-z_$]?[\w$]*\s*\(([^)]*)\)/g, 1],
    [/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g, 1],
    [/\(([^()]*)\)\s*=>/g, 1],
    [/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g, 1],
    // methodes abregees d'objet et de classe : nom(args) {
    [/(?:^|[{,;}\s])([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g, 2],
    // destructuration : const { a, b: c } = x ; const [a, b] = y
    [/\b(?:const|let|var)\s*\{([^}]*)\}/g, 1],
    [/\b(?:const|let|var)\s*\[([^\]]*)\]/g, 1],
    // destructuration dans les parametres : function f({ a, b })
    [/\(\s*\{([^}]*)\}\s*[,)]/g, 1],
    // for (const x of ...) et boucles indexees
    [/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g, 1],
    // imports
    [/\bimport\s+([A-Za-z_$][\w$]*)\s+from/g, 1],
    [/\bimport\s*\{([^}]*)\}\s*from/g, 1],
    [/\bimport\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g, 1],
  ];

  for (const [re, groupe] of motifs) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(src))) ajoute(m[groupe]);
  }

  // Alias d'import et de destructuration : { a as b } et { a: b }. C'est le
  // second nom qui est lie, mais le premier ne coute rien de plus.
  let m;
  const alias = /([A-Za-z_$][\w$]*)\s*(?:as|:)\s*([A-Za-z_$][\w$]*)/g;
  while ((m = alias.exec(src))) { noms.add(m[1]); noms.add(m[2]); }

  return noms;
}

/* --- ce qui est reference ---------------------------------------------------- */

/**
 * Identifiants LIBRES : ni proprietes (`objet.nom`), ni cles d'objet
 * (`{ nom: ... }`). Ce sont les seuls qui doivent se resoudre a une liaison.
 */
function referenced(src) {
  const vus = new Map();
  let ligne = 1;
  let position = 0;

  scan(src, (mot, ctx) => {
    // Suivre la ligne pour rendre un message utilisable.
    while (position < src.length && src.indexOf(mot, position) > position) {
      const saut = src.indexOf('\n', position);
      if (saut === -1 || saut > src.indexOf(mot, position)) break;
      ligne++;
      position = saut + 1;
    }
    if (!ctx.member && !ctx.key && !vus.has(mot)) vus.set(mot, ligne);
    return undefined;
  });

  return vus;
}

/**
 * Les references qu'aucune liaison ni aucun global n'explique.
 *
 * `extraGlobals` sert aux fichiers qui tournent dans un contexte particulier --
 * le moteur ES5, par exemple, qui vit dans une IIFE et voit les noms des autres
 * modules concatenes.
 */
export function undefinedRefs(fichier, { extraGlobals = [] } = {}) {
  const src = readFileSync(fichier, 'utf8');
  const lies = declared(src);
  const connus = new Set([...GLOBALS, ...extraGlobals]);

  const manquants = [];
  for (const [mot, ligne] of referenced(src)) {
    if (lies.has(mot) || connus.has(mot)) continue;
    // Un nom tout en majuscules non declare est presque toujours une constante
    // importee qu'une de nos regexes a manquee : on se tait plutot que de crier.
    if (/^[A-Z0-9_]+$/.test(mot)) continue;
    manquants.push({ mot, ligne });
  }
  return manquants;
}
