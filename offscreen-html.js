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
function echantillon(el) {
  const attrs = {};
  for (const nom of ['id', 'class', 'href', 'data-a-target', 'aria-label']) {
    const v = el.getAttribute && el.getAttribute(nom);
    if (v) attrs[nom] = coupe(v);
  }
  const html = String(el.outerHTML || '');
  return {
    tag: String(el.tagName || '').toLowerCase(),
    attrs,
    text: coupe(el.textContent).slice(0, 120),
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
          .map(echantillon);
      } catch {
        structure[sp.name] = [];
      }
    }

    const texte = doc.body ? doc.body.textContent || '' : '';
    const matches = {};
    for (const p of patterns || []) {
      if (!p || !p.name || !p.source) continue;
      try {
        matches[p.name] = new RegExp(p.source, p.flags || 'i').test(texte);
      } catch {
        matches[p.name] = false;
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
