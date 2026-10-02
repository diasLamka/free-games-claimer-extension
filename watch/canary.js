/* Savoir qu'un magasin a bouge avant que l'offre soit ratee.
 *
 * C'est le mode d'echec dominant de ce projet, et le changelog le dit sans
 * ambiguite : quatre des six dernieres versions du moteur corrigent un libelle
 * ou un selecteur qui a change sous nos pieds -- 2.12.1 (Epic saute l'etape
 * panier), 2.13.1 (les titres de modales quittent h1-h3), 2.13.2 (un span
 * invisible casse un motif ancre), 2.13.4 (l'iframe Turnstile passe dans un
 * shadow root ferme). Et avant elles 2.3.0, 2.5.0 et 2.7.0 sur les accents.
 *
 * A chaque fois le meme scenario : le magasin change, l'extension echoue, le
 * recul l'espace poliment, et personne n'apprend rien. L'utilisateur le
 * decouvre en constatant qu'un jeu lui manque -- quand il le constate.
 *
 * CE MODULE N'OUVRE RIEN ET NE CLIQUE NULLE PART. Il lit les verdicts que la
 * reclamation produit deja, et compte. C'est delibere : une sonde qui irait
 * verifier la presence d'un bouton sur une page ouverte couterait une requete
 * de plus sur un vrai compte pour apprendre ce que le prochain echec dira de
 * toute facon.
 *
 * DEUX DECISIONS QUI VIENNENT DU CHANGELOG.
 *
 *   Un DELAI DEPASSE compte comme une preuve de selecteur. La 2.12.1 s'est
 *   presentee sous la forme « waitForElement: timeout apres 10000ms » : Epic
 *   affichait « Ajouter a la bibliotheque » sans etape panier, le flux
 *   attendait un bouton panier qui n'existait plus, et expirait. Le symptome
 *   d'un libelle qui bouge est une attente qui n'aboutit pas, pas un message
 *   qui dit « selecteur introuvable ».
 *
 *   Une RECONNEXION n'est pas une preuve, ni dans un sens ni dans l'autre. Le
 *   moteur s'arrete avant d'avoir regarde le moindre bouton : compter cet
 *   echec accuserait le magasin a tort, et le compter comme un succes
 *   effacerait une serie en cours.
 *
 * Module pur.
 */

/** Cle de stockage. Espace de la veille, jamais l'espace FGC_* du moteur. */
export const KEY_CANARY = 'veille:canari';

/**
 * Deux echecs de selecteur d'affilee suffisent.
 *
 * Le recul etale deja les tentatives -- 15 min, 1 h, 4 h, 12 h. Deux echecs
 * consecutifs sur le meme magasin, c'est donc au moins un quart d'heure
 * d'ecart et deux pages differentes : ce n'est plus un accident de chargement.
 */
export const ALERT_AFTER = 2;

/**
 * Sans succes anterieur, il en faut un de plus.
 *
 * Un magasin qui n'a jamais rien reclame peut n'avoir jamais ete essaye, ou
 * n'avoir pas de compte. Crier des le deuxieme echec dans ce cas apprend a
 * l'utilisateur a ignorer le canari, ce qui le rend pire qu'inutile.
 */
export const ALERT_AFTER_UNPROVEN = 3;

export const KINDS = Object.freeze({
  /** Le parcours est alle au bout : les selecteurs ont donc fonctionne. */
  SUCCESS: 'success',
  /** Un libelle, un bouton, une modale : le magasin a probablement bouge. */
  SELECTOR: 'selector',
  /** Il manque un humain. Le moteur s'arrete avant de regarder la page. */
  HUMAN: 'human',
  /** Ne dit rien de l'etat du magasin. */
  OTHER: 'other',
});

/** Verdicts qui prouvent que le parcours a fonctionne de bout en bout. */
const SUCCESS_VERDICTS = Object.freeze([
  'claimed', 'redeemed', 'already_redeemed', 'code_pending_gog', 'code_copied',
]);

/** Verdicts qui attendent une personne : le moteur n'a rien pu constater. */
const HUMAN_VERDICTS = Object.freeze(['needs_login', 'needs_link', 'challenge']);

/**
 * Motifs d'echec qui ne parlent PAS du magasin, et qui sont testes en premier.
 *
 * Une page qui ne finit pas de charger, un content script qui ne s'annonce
 * pas, un ordre qui ne passe pas : ce sont nos pannes, pas celles d'Epic. Les
 * compter ferait crier le canari a chaque coupure reseau.
 *
 * 2.99.4 : deux autres motifs qui sont les NOTRES -- un paquet Steam que la
 * source n'a pas donne (« paquet Steam inconnu »), et un controle d'age que
 * seul un humain passe : ni l'un ni l'autre ne dit que Steam a change sa page.
 *
 * 2.99.1 : « injection impossible : Frame with ID 0 is showing error page ».
 * L'onglet affichait la page d'erreur de Chrome -- le reseau n'etait pas
 * revenu au reveil de l'ordinateur --, et l'alerte accusait Steam d'avoir
 * change sa page. Une injection qui echoue ne dit rien du magasin : le script
 * n'est jamais arrive jusqu'a lui.
 */
const NOT_STORE = /pas fini de charger|ne s'est pas annonce|d'atterrissage illisible|ordre non transmis|hors ligne|network|failed to fetch|injection impossible|showing error page|frame with id|no tab with id|cannot access|net::err_|paquet steam inconnu|controle d'age/i;

/**
 * Ce qu'un verdict dit de l'etat des selecteurs du magasin.
 *
 * La regle est volontairement grossiere, et c'est ce qui la rend fiable : un
 * `failed` dont le motif n'est pas l'un des NOTRES parle du magasin. On
 * n'essaie pas de reconnaitre la forme d'un echec de selecteur, parce que
 * cette forme change a chaque fois -- « waitForElement: timeout apres
 * 10000ms » pour la 2.12.1, « bouton introuvable » pour la 2.13.2, une page
 * 403 pour la 2.13.4. Une liste de motifs a reconnaitre aurait rate les trois,
 * chacun pour une raison differente.
 *
 * Rend toujours une des quatre valeurs de KINDS : l'appelant n'a jamais a
 * deviner ce que veut dire l'absence de reponse.
 */
export function classify(verdict, details = null) {
  const v = String(verdict || '').toLowerCase();
  if (SUCCESS_VERDICTS.includes(v)) return KINDS.SUCCESS;
  if (HUMAN_VERDICTS.includes(v)) return KINDS.HUMAN;
  /* Le moteur a lu la page et n'y reconnait aucun bouton (2.102.0) : c'est
     exactement ce que le canari cherche -- le magasin a change -- meme si la
     reparation passe, cette fois, par l'utilisateur. */
  if (v === 'needs_teaching') return KINDS.SELECTOR;

  /* `undetermined` n'accuse personne : il veut dire que le service worker est
     mort en pleine reclamation. C'est notre panne, pas celle du magasin. */
  if (v !== 'failed') return KINDS.OTHER;

  return NOT_STORE.test(String(details || '')) ? KINDS.OTHER : KINDS.SELECTOR;
}

/** L'etat d'un magasin, vierge. */
function blank() {
  return { streak: 0, since: null, lastAt: null, lastDetails: null, lastOkAt: null };
}

/**
 * Integre un verdict et rend un NOUVEL etat.
 *
 * Un succes remet le compteur a zero : c'est la seule chose qui prouve que le
 * parcours entier fonctionne, et elle doit donc pouvoir eteindre une alerte
 * sans intervention.
 */
export function observe(state, { store, verdict, details = null, ts = Date.now() } = {}) {
  if (!store) return { ...(state || {}) };

  const base = { ...(state || {}) };
  const courant = { ...blank(), ...(base[store] || {}) };
  const genre = classify(verdict, details);

  if (genre === KINDS.SUCCESS) {
    base[store] = { ...courant, streak: 0, since: null, lastDetails: null, lastAt: ts, lastOkAt: ts };
    return base;
  }
  if (genre === KINDS.SELECTOR) {
    base[store] = {
      ...courant,
      streak: courant.streak + 1,
      since: courant.streak === 0 ? ts : courant.since,
      lastAt: ts,
      lastDetails: details ? String(details) : courant.lastDetails,
    };
    return base;
  }
  // HUMAN et OTHER : on ne touche a rien. Ni accusation, ni absolution.
  return base;
}

/**
 * Les magasins sur lesquels il faut alerter, le plus casse d'abord.
 *
 * Un magasin qui a deja fonctionne alerte a partir de deux echecs, un magasin
 * qui n'a jamais rien reclame a partir de trois. Voir ALERT_AFTER_UNPROVEN.
 */
export function alerts(state, { threshold = ALERT_AFTER, unprovenThreshold = ALERT_AFTER_UNPROVEN } = {}) {
  const out = [];
  for (const [store, s] of Object.entries(state || {})) {
    if (!s || !Number.isFinite(s.streak)) continue;
    const plancher = s.lastOkAt ? threshold : unprovenThreshold;
    if (s.streak < plancher) continue;
    out.push({
      store,
      streak: s.streak,
      since: s.since ?? null,
      lastAt: s.lastAt ?? null,
      lastDetails: s.lastDetails ?? null,
      lastOkAt: s.lastOkAt ?? null,
    });
  }
  return out.sort((a, b) => b.streak - a.streak || String(a.store).localeCompare(String(b.store)));
}

/**
 * Le magasin repart de zero.
 *
 * Sert au bouton « j'ai regarde » : une alerte qu'on ne peut pas acquitter est
 * une alerte qui finit ignoree, et le canari ne sert plus a rien.
 */
export function acknowledge(state, store) {
  const base = { ...(state || {}) };
  if (!base[store]) return base;
  base[store] = { ...base[store], streak: 0, since: null, lastDetails: null };
  return base;
}

/**
 * Une ligne de journal pour une alerte qui vient de naitre.
 *
 * Le motif technique y est recopie tel quel : c'est lui qui nomme le bouton
 * manquant, et une capture de cette ligne suffit a corriger (2.13.2).
 */
export function alertLine(alert) {
  const base = `${alert.store} : ${alert.streak} echec(s) de selecteur d'affilee`;
  return alert.lastDetails ? `${base} -- ${alert.lastDetails}` : base;
}

/**
 * Les alertes que l'etat precedent ne portait pas encore.
 *
 * C'est ce qui permet de n'ecrire au journal qu'une fois par alerte, au lieu
 * de repeter la meme ligne a chaque cycle jusqu'a ce qu'elle soit illisible.
 */
export function newAlerts(before, after, options = {}) {
  const avant = new Set(alerts(before, options).map((a) => a.store));
  return alerts(after, options).filter((a) => !avant.has(a.store));
}
