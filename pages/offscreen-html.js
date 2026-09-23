/* Le document offscreen qui lit du HTML pour le service worker.
 *
 * Il repond a des questions GENERIQUES : « que contiennent les elements qui
 * repondent a ce selecteur ? ». Aucune connaissance de magasin ne vit ici, et
 * ce n'est pas un scrupule d'architecture : cette page ne peut etre chargee
 * par aucun test -- elle a besoin d'un navigateur. Y mettre la logique d'une
 * source reviendrait a renoncer a la tester.
 *
 * La logique des sources vit donc dans watch/sources/*.js, en fonctions pures
 * qui prennent ce que cette page rend : des objets simples et serialisables.
 */
const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

/** Au-dela, la reponse serait de toute facon inexploitable. */
const MAX_ROWS = 200;
const MAX_TEXT = 300;

/* Echantillons de structure : combien, et jusqu'ou.
 *
 * Ils existent pour une raison precise : compter les elements qui repondent a
 * un selecteur dit SI la page a change, pas EN QUOI. Une mesure qui rend « 0 »
 * oblige a en relancer une autre avec d'autres selecteurs, et ainsi de suite.
 * Un echantillon de structure permet d'ecrire le bon selecteur du premier
 * coup, ce qui est tout l'interet de mesurer. */
const MAX_SAMPLES = 8;
const MAX_HTML = 400;
/** Un extrait de valeur JSON : assez pour lire un schema, pas pour le recopier. */
const MAX_DUMP = 1800;

function coupe(texte) {
  const t = String(texte || '').replace(/\s+/g, ' ').trim();
  return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) : t;
}

/**
 * Resout une valeur d'attribut en URL absolue quand c'en est une.
 *
 * Un href relatif rendu tel quel serait inutilisable par l'appelant : le
 * service worker n'a pas de page de reference pour le resoudre.
 */
function valeur(el, attr, base) {
  const brut = el.getAttribute(attr);
  if (brut === null) return null;
  if (attr !== 'href' && attr !== 'src') return coupe(brut);
  try { return new URL(brut, base).href; } catch { return coupe(brut); }
}

/** Ce qu'un element a d'identifiant, sans recopier la page entiere. */
function echantillon(el, needles, dumpKeyMatch) {
  const attrs = {};
  for (const nom of ['id', 'class', 'href', 'type', 'data-a-target', 'aria-label']) {
    const v = el.getAttribute && el.getAttribute(nom);
    if (v) attrs[nom] = coupe(v);
  }
  const html = String(el.outerHTML || '');
  const contenu = String(el.textContent || '');

  /* Ce que l'element contient VRAIMENT, mot par mot.
   *
   * C'est ce qui transforme « 3 blocs de donnees embarquees » en « le bloc
   * __NEXT_DATA__ contient le mot giveaway » : la difference entre une mesure
   * qu'il faut relancer et une mesure sur laquelle on peut ecrire du code. */
  const bas = contenu.toLowerCase();
  const hits = [];
  const around = {};
  for (const n of needles || []) {
    if (!n) continue;
    const i = bas.indexOf(String(n).toLowerCase());
    if (i < 0) continue;
    hits.push(n);
    /* Le voisinage, pas seulement la presence.
     *
     * « le mot giveaway est quelque part dans ce bloc » ne se code pas.
     * « ...,"giveaway":{"id":123,"product":{...} » se code. C'est la
     * difference entre une mesure de plus et la fin des mesures. */
    around[n] = contenu.slice(Math.max(0, i - 120), i + 240);
  }

  /* Les cles de premier niveau d'un bloc JSON.
   *
   * Mesurer un schema plutot que le supposer : si `gogcom-store-state` porte
   * une cle `giveaway`, on le saura sans avoir a deviner son nom. */
  let topKeys = null;
  let dump = null;
  if ((attrs.type || '').includes('json')) {
    try {
      const parsed = JSON.parse(contenu);
      if (parsed && typeof parsed === 'object') {
        const cles = Object.keys(parsed);
        topKeys = cles.slice(0, 60);

        /* Le contenu d'une cle, pas seulement son nom.
         *
         * Connaitre la cle « sections.gog/v1/pages/2f?... » dit qu'une API de
         * sections existe ; voir sa valeur dit quel champ porte le prix, le
         * titre et la gratuite. La premiere information se raconte, la seconde
         * se code. */
        if (dumpKeyMatch) {
          const trouvee = cles.find((k) => k.includes(dumpKeyMatch));
          if (trouvee) {
            const valeur = JSON.stringify(parsed[trouvee]);
            dump = { key: trouvee, excerpt: valeur.slice(0, MAX_DUMP), chars: valeur.length };
          }
        }
      }
    } catch { topKeys = ['<json illisible>']; }
  }

  return {
    tag: String(el.tagName || '').toLowerCase(),
    attrs,
    chars: contenu.length,
    hits,
    around,
    topKeys,
    dump,
    text: coupe(contenu).slice(0, 120),
    html: html.length > MAX_HTML ? `${html.slice(0, MAX_HTML)}\u2026` : html,
  };
}

async function lire({ url, queries, patterns, samples, timeoutMs }) {
  const debut = performance.now();
  const controle = new AbortController();
  const minuterie = setTimeout(() => controle.abort(), timeoutMs || 20000);

  try {
    /* credentials: 'omit' : cette page ne lit que du PUBLIC. Envoyer les
       cookies de l'utilisateur a un magasin depuis un contexte invisible
       serait agir en son nom sans qu'il le sache. */
    const r = await fetch(url, { credentials: 'omit', signal: controle.signal });
    const html = await r.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const results = {};
    for (const q of queries || []) {
      if (!q || !q.name || !q.selector) continue;
      let trouves = [];
      try {
        trouves = Array.from(doc.querySelectorAll(q.selector)).slice(0, MAX_ROWS);
      } catch {
        // Un selecteur invalide est une erreur de l'appelant, pas une panne
        // de la page : on rend une liste vide et on continue les autres.
        results[q.name] = [];
        continue;
      }
      results[q.name] = trouves.map((el) => ({
        text: coupe(el.textContent),
        value: q.attr ? valeur(el, q.attr, url) : null,
      }));
    }

    /* Les echantillons de structure. Le selecteur peut etre volontairement
       large -- [class*="giveaway"] -- puisqu'on cherche ce qui existe, pas ce
       qu'on croit deja savoir. */
    const structure = {};
    for (const sp of samples || []) {
      if (!sp || !sp.name || !sp.selector) continue;
      try {
        structure[sp.name] = Array.from(doc.querySelectorAll(sp.selector))
          .slice(0, Math.min(sp.limit || MAX_SAMPLES, MAX_SAMPLES))
          .map((el) => echantillon(el, sp.needles, sp.dumpKeyMatch));
      } catch {
        structure[sp.name] = [];
      }
    }

    /* Le texte RENDU, sans les scripts.
     *
     * `body.textContent` inclut le contenu des balises script : chercher un
     * mot dedans confond « la page l'affiche » et « la page le transporte dans
     * du JSON ». La premiere mesure a rendu « giveaway : oui » sans qu'on
     * puisse savoir laquelle des deux etait vraie -- et les deux n'appellent
     * pas le meme code. On mesure donc les deux separement. */
    const clone = doc.body ? doc.body.cloneNode(true) : null;
    if (clone) {
      for (const mort of clone.querySelectorAll('script, style, noscript, template')) mort.remove();
    }
    const texte = clone ? clone.textContent || '' : '';

    const matches = {};
    const matchesRaw = {};
    for (const p of patterns || []) {
      if (!p || !p.name || !p.source) continue;
      try {
        const re = new RegExp(p.source, p.flags || 'i');
        matches[p.name] = re.test(texte);
        matchesRaw[p.name] = re.test(html);
      } catch {
        matches[p.name] = false;
        matchesRaw[p.name] = false;
      }
    }

    return {
      ok: true,
      status: r.status,
      bytes: html.length,
      title: coupe(doc.title).slice(0, 120),
      results,
      samples: structure,
      matches,
      matchesRaw,
      ms: Math.round(performance.now() - debut),
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), ms: Math.round(performance.now() - debut) };
  } finally {
    clearTimeout(minuterie);
  }
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'fgc-offscreen-html') return;
  lire(msg).then(sendResponse);
  return true;   // reponse asynchrone
});
