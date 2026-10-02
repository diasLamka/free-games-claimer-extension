/* Qui a le droit de demander quoi au service worker.
 *
 * Le worker ecoute seize commandes sur un seul `onMessage`, et jusqu'ici sa
 * seule verification tenait en une ligne : « le message a-t-il un type ? ».
 * Aucune branche ne distinguait une page de l'extension d'un script de
 * contenu. Or les deux n'ont rien a voir :
 *
 *   - le POPUP et les pages annexes sont NOTRE code, servi depuis
 *     chrome-extension:// ;
 *   - le SCRIPT DE CONTENU tourne dans une page de magasin. Il est a nous
 *     aussi, mais il vit chez Epic, GOG et Amazon -- des hotes que nous ne
 *     controlons pas.
 *
 * Rien de tout cela n'etait exploitable depuis le web : sans
 * `externally_connectable`, aucune page ne peut parler a l'extension, et il
 * faudrait deja controler le script de contenu pour atteindre ces branches.
 * C'est donc de la defense en profondeur -- le genre de garde qu'on pose
 * pendant qu'on a le temps, pas le jour ou elle manque.
 *
 * Module PUR : aucune API d'extension, aucun acces reseau. Le `sender` et la
 * liste d'hotes lui sont passes.
 */

/* ------------------------------------------------------- origine du message */

/**
 * D'ou vient ce message ?
 *
 * `page`    une page de l'extension (popup, journal, collection, diagnostic,
 *           sentinelle). Reconnue par son URL, qui commence par la base
 *           chrome-extension:// de CETTE extension.
 * `content` un script de contenu : il porte un `sender.tab`.
 * `inconnu` ni l'un ni l'autre. On refuse.
 *
 * L'ordre compte : une page d'extension n'a pas de `sender.tab` quand c'est
 * le popup, mais elle en a un quand c'est un onglet (journal, collection).
 * C'est donc l'URL qui tranche EN PREMIER, jamais la presence d'un onglet.
 */
export function senderKind(sender, extensionBase) {
  const url = (sender && sender.url) || '';
  if (extensionBase && url.startsWith(extensionBase)) return 'page';
  if (sender && sender.tab && sender.tab.id !== undefined) return 'content';
  return 'inconnu';
}

/**
 * Les commandes que SEULE une page de l'extension peut demander.
 *
 * Ce sont celles qui agissent sur un vrai compte ou sur des donnees : lancer
 * une importation de bibliotheque (qui lit Steam, GOG et Epic AVEC les
 * cookies de l'utilisateur), forcer une vague de reclamations, effacer le
 * journal, passer outre le recul d'une source. Un script de contenu n'a
 * aucune raison de les demander -- et jusqu'ici il le pouvait.
 */
export const UI_COMMANDS = Object.freeze([
  'fgc-check-now', 'fgc-mark-seen', 'fgc-claim-all', 'fgc-sweep-tabs',
  'fgc-retry', 'fgc-prune', 'fgc-sentinel', 'fgc-canary-ack',
  'fgc-journal-clear', 'fgc-collection-import', 'fgc-session-probe',
  'fgc-watch-state',
  /* La file pilotable (2.29.0) : reclamer une offre precise, la prioriser, la
     reporter. Les trois agissent sur le catalogue ou sur un vrai compte, donc
     elles sont reservees aux pages de l'extension comme les precedentes. */
  'fgc-claim-one', 'fgc-prioritise', 'fgc-snooze',
  /* La liste de souhaits (2.31.0). Elle est lue a chaque cycle : le popup
     demande, le worker ecrit. */
  'fgc-wish',
  /* L'apprentissage d'un libelle (2.36.0). Il ecrit une cle que le MOTEUR
     lit avant chaque clic : un script de contenu n'a rien a y faire. */
  'fgc-teach',
  /* Le temps de jeu Steam (2.39.0). Lecture authentifiee sur un hote demande
     en permission optionnelle : reservee aux pages, comme l'import. */
  'fgc-playtime',
  /* La passerelle locale (2.40.0). Elle ouvre un canal vers un PROGRAMME de
     la machine : c'est la commande la plus puissante du lot, et elle est
     donc reservee aux pages de l'extension comme toutes les autres. */
  'fgc-bridge',
  /* L'essai du telephone (2.47.0). Il envoie un message vers un hote que
     l'utilisateur a choisi : reserve aux pages, comme tout ce qui sort. */
  'fgc-phone-test',
  /* La mise a jour a la demande (2.54.0). Elle fait tourner un programme de
     la machine, par le relais que l'utilisateur a installe : reservee aux
     pages, comme la passerelle. */
  'fgc-maj',
  /* L'essai a blanc (2.64.0). Il ouvre des pages de magasin avec la session
     de l'utilisateur, sans rien y cliquer : reserve aux pages, comme la
     sonde de session. */
  'fgc-dry-run',
  /* La restauration d'une sauvegarde (2.74.0). Elle ecrit le registre, les
     historiques du moteur et les listes : reservee aux pages, et c'est le
     worker qui fusionne. */
  'fgc-restore',
  /* La sauvegarde automatique, tout de suite (2.77.0) : le clic qui l'active
     veut voir un premier fichier. Elle ecrit sur le disque : pages seulement. */
  'fgc-auto-backup',
  /* Les jaquettes de « Deja recupere » (2.81.0) : le popup nomme les titres
     affiches, le worker cherche et ecrit. Pages seulement. */
  'fgc-covers',
  /* « Ce soir je joue a... » (2.96.0) : le jeu montre n'a pas encore sa
     fiche Steam ; le worker la lit tout de suite. Pages seulement. */
  'fgc-tonight',
  'fgc-taste',
  /* « Je suis de retour » (2.84.0) : le resume part tout de suite. */
  'fgc-vacation-back',
]);

/**
 * Les messages que seul un script de contenu emet.
 *
 * Ils portent tous sur l'onglet d'ou ils viennent, et le worker lit cet
 * onglet dans `sender.tab` -- jamais dans le message. Une page d'extension
 * n'a rien a y faire.
 */
export const CONTENT_MESSAGES = Object.freeze([
  'fgc-suis-je-pilote', 'fgc-pret', 'fgc-verdict', 'fgc-fetch',
  'fgc-notify', 'fgc-open-tab',
  /* La surcouche des pages de magasin (2.37.0), devenue le lanceur (2.51.0).
     Elle LIT : aucune ecriture, aucun clic, aucune reclamation. C'est pour
     cela qu'elle a le droit de venir d'un script de contenu, contrairement
     aux commandes. */
  'fgc-lookup',
  /* Le bouton « tableau de bord » du panneau (2.62.0) : ouvre la page
     d'options, sans adresse dans le message -- rien a detourner. */
  'fgc-open-dashboard',
  /* La reponse du moteur a l'essai a blanc (2.64.0) : ce qu'il a vu sur la
     page, jamais un clic. Meme chemin que `fgc-verdict`. */
  'fgc-inspection',
  /* L'anti-doublon (2.87.0) : la fiche d'un jeu demande si on le possede
     deja ailleurs. Elle LIT, comme le lanceur : aucune ecriture. */
  'fgc-owned-guard',
  /* Le moteur a appris un bouton d'un clic de l'utilisateur (2.102.0). Le worker
     reessaie les offres du magasin et referme l'onglet : il lit l'onglet dans
     `sender.tab`, jamais dans le message. */
  'fgc-appris',
]);

/**
 * Ce message s'adresse-t-il au service worker ?
 *
 * `chrome.runtime.sendMessage` arrose TOUS les contextes de l'extension : le
 * worker recoit aussi ce qui ne lui est pas destine. `fgc-diag-offscreen-run`
 * par exemple part de la page de diagnostic vers le document de sonde
 * (`probe-offscreen.js`), et le worker n'a jamais eu de branche pour lui.
 *
 * D'ou cette question posee AVANT celle de l'origine : un type qui n'est pas
 * le notre se laisse passer en silence. Le refuser avec un avertissement
 * remplirait le journal a chaque mesure de diagnostic, pour un message
 * parfaitement legitime adresse a quelqu'un d'autre.
 */
export function isOurs(type) {
  return UI_COMMANDS.includes(type) || CONTENT_MESSAGES.includes(type);
}

/**
 * Ce message a-t-il le droit de venir de la ?
 *
 * Un type inconnu est refuse : la liste est la definition du contrat, et une
 * branche ajoutee sans y etre inscrite doit echouer bruyamment en test
 * plutot que passer en silence en production. C'est `isOurs` qui filtre en
 * amont ce qui ne nous concerne pas.
 */
export function messageAllowed(type, kind) {
  if (kind === 'inconnu') return false;
  if (UI_COMMANDS.includes(type)) return kind === 'page';
  if (CONTENT_MESSAGES.includes(type)) return kind === 'content';
  return false;
}

/* ----------------------------------------------------------- relais reseau */

/**
 * Les hotes vers lesquels le relais accepte de partir.
 *
 * Tires des `host_permissions` du manifeste, et c'est le point : la liste ne
 * peut pas deriver de ce que l'extension a le droit de lire, puisque c'est
 * la meme. Un motif « https://\*.epicgames.com/\* » devient un test d'hote.
 */
export function hostMatchers(patterns) {
  const matchers = [];
  for (const motif of patterns || []) {
    const m = /^https:\/\/([^/]+)\//.exec(String(motif));
    if (!m) continue;
    const hote = m[1];
    if (hote.startsWith('*.')) {
      const base = hote.slice(2).toLowerCase();
      matchers.push((h) => h === base || h.endsWith('.' + base));
    } else {
      const exact = hote.toLowerCase();
      matchers.push((h) => h === exact);
    }
  }
  return matchers;
}

/**
 * Ce que le relais accepte de faire, et rien d'autre.
 *
 * Il etait ouvert : URL libre, methode libre, en-tetes libres, corps entier
 * rendu a l'appelant. De quoi sonder http://localhost ou une adresse interne
 * depuis le service worker. Son unique appelant reel -- la verification de
 * l'API publique Epic (`src/core/13-epic-check.js`) -- ne fait qu'un GET avec
 * un seul en-tete.
 *
 * On borne donc au strict besoin : HTTPS, GET, un hote autorise, et `Accept`
 * pour tout bagage. Rend `{ url, init }` ou `{ refus }` -- jamais une
 * exception : un refus est une reponse, pas une panne.
 */
export function relayRequest(msg, matchers) {
  const brut = String((msg && msg.url) || '');

  let cible;
  try {
    cible = new URL(brut);
  } catch {
    return { refus: 'URL illisible' };
  }
  if (cible.protocol !== 'https:') return { refus: `schema refuse : ${cible.protocol}` };

  const methode = String((msg && msg.method) || 'GET').toUpperCase();
  if (methode !== 'GET') return { refus: `methode refusee : ${methode}` };

  const hote = cible.hostname.toLowerCase();
  if (!(matchers || []).some((test) => test(hote))) return { refus: `hote hors permissions : ${hote}` };

  /* Un seul en-tete recopie, et sa valeur est verifiee. Tout le reste est
     jete en silence : le relais n'est pas un tunnel. */
  const entrants = (msg && msg.headers) || {};
  const accept = Object.keys(entrants).find((k) => k.toLowerCase() === 'accept');
  const headers = {};
  if (accept && /^[\w.+*/, =;-]{1,120}$/.test(String(entrants[accept]))) {
    headers.Accept = String(entrants[accept]);
  }

  return { url: cible.toString(), init: { method: 'GET', headers, credentials: 'omit' } };
}
