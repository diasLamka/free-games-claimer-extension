/* Page de diagnostic : mesure les deux hypotheses non verifiees du design
 * (V0-2 throttling d'un onglet de fond, V0-3 document offscreen).
 *
 * Tout est pilote depuis cette page, jamais depuis le service worker : un
 * service worker MV3 s'arrete des qu'il est inactif et ne survivrait pas a une
 * mesure de six minutes. Une page d'extension, elle, vit tant que son onglet
 * est ouvert -- a condition de rester au premier plan, sinon Chrome la bride
 * exactement comme la cible qu'elle mesure.
 */
import { queryHtml } from './watch/offscreen.js';

const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

// robots.txt plutot qu'une page de magasin complete : le throttling ne depend
// pas du poids de la page, et une page legere evite un chargement inutile.
// La cible est choisie dans la page : l'hote de l'agregateur n'a pas de
// content_script, ce qui permet de mesurer sans le moteur dans l'onglet.
const SEUIL_INTENSIF_MS = 5 * 60 * 1000;
const INTERVALLE_MS = 1000;

const $ = (id) => document.getElementById(id);
const resultats = { throttle: null, offscreen: null, sonde: null };

$('version').textContent = 'v' + api.runtime.getManifest().version;

/* ---------------------------------------------------------------- utilitaires */

const mediane = (xs) => {
  if (!xs.length) return null;
  const t = [...xs].sort((a, b) => a - b);
  const m = t.length >> 1;
  return t.length % 2 ? t[m] : Math.round((t[m - 1] + t[m]) / 2);
};

const secondes = (ms) => (ms / 1000).toFixed(1).replace('.', ',') + ' s';

function verdict(el, niveau, title, detail) {
  el.className = 'verdict ' + niveau;
  el.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = title;
  el.append(b, document.createTextNode(detail));
}

/* Met le mode automatique du moteur en pause pendant la mesure, et rend une
   fonction qui retablit l'etat d'origine. Sans cela, l'onglet de fond ouvert
   sur un domaine Epic declencherait une verification pendant qu'on la mesure. */
async function suspendreMoteur() {
  const { FGC_auto_state: before } = await api.storage.local.get('FGC_auto_state');
  const jusqua = Date.now() + 30 * 60 * 1000;
  await api.storage.local.set({ FGC_auto_state: JSON.stringify({ epic: jusqua, luna: jusqua }) });
  return async () => {
    if (before === undefined) await api.storage.local.remove('FGC_auto_state');
    else await api.storage.local.set({ FGC_auto_state: before });
  };
}

function awaitLoad(tabId) {
  return new Promise((resolve) => {
    const done = (id, info) => {
      if (id !== tabId || info.status !== 'complete') return;
      api.tabs.onUpdated.removeListener(done);
      resolve();
    };
    api.tabs.onUpdated.addListener(done);
    // L'onglet peut avoir fini de charger avant que l'ecouteur soit pose.
    api.tabs.get(tabId).then((t) => {
      if (t && t.status === 'complete') { api.tabs.onUpdated.removeListener(done); resolve(); }
    }).catch(() => {});
  });
}

/* ------------------------------------------------------- V0-2 : le throttling */

/* Injectee dans l'onglet de fond. Doit etre autonome : elle est serialisee,
   donc elle ne capture rien de la portee de cette page. */
function sondeThrottling(opts) {
  const { totalMs, intervalMs, etapesReclamation } = opts;
  const t0 = performance.now();
  // Le callback vide consomme runtime.lastError : personne ne repond a ces
  // messages, et sans lui Chrome journalise un avertissement par battement.
  const envoyer = (m) => {
    try {
      chrome.runtime.sendMessage(Object.assign({ __fgcDiag: true }, m), () => void chrome.runtime.lastError);
    } catch (e) {}
  };

  envoyer({ kind: 'start', visibility: document.visibilityState });

  // Phase 1 : la cadence exacte d'une reclamation Epic reelle.
  let i = 0;
  const claimT0 = performance.now();
  function etapeSuivante() {
    if (i >= etapesReclamation.length) {
      envoyer({ kind: 'claim-done', ms: performance.now() - claimT0, visibility: document.visibilityState });
      latest = performance.now();
      setTimeout(battre, intervalMs);
      return;
    }
    setTimeout(etapeSuivante, etapesReclamation[i++]);
  }

  // Phase 2 : un battement par seconde, pour observer le regime au-dela de 5 min.
  let latest = 0;
  function battre() {
    const now = performance.now();
    const ecart = now - latest;
    latest = now;
    const since = now - t0;
    envoyer({ kind: 'tick', at: since, gap: ecart, visibility: document.visibilityState });
    if (since >= totalMs) { envoyer({ kind: 'done', at: since }); return; }
    setTimeout(battre, intervalMs);
  }

  etapeSuivante();
}

/* Reproduit la sequence de sommeils d'une reclamation Epic : une dizaine de
   randomDelay(claimDelayMin, claimDelayMax) puis epicClaimVerifyDelayMs. */
function etapesReclamationEpic() {
  const etapes = [];
  for (let i = 0; i < 11; i++) etapes.push(Math.round(800 + Math.random() * 1400));
  etapes.push(2500);
  return etapes;
}

let mesureEnCours = null;

async function lancerThrottling() {
  const totalMs = Number($('throttle-duration').value);
  const PROBE_URL = $('throttle-target').value;
  const etapes = etapesReclamationEpic();
  const attendu = etapes.reduce((a, b) => a + b, 0);

  $('throttle-run').disabled = true;
  $('throttle-stop').disabled = false;
  $('throttle-out').classList.remove('hidden');
  $('throttle-state').textContent = 'ouverture de l\'onglet...';
  $('r-visibility').textContent = '--';
  $('r-claim').textContent = '--';
  $('r-before').textContent = '--';
  $('r-after').textContent = '--';
  $('r-ticks').textContent = '--';
  verdict($('r-verdict'), '', 'Mesure en cours', '');

  const retablir = await suspendreMoteur();
  let tabId = null;
  const battements = [];
  let visibilite = null;
  let dureeReclamation = null;

  const nettoyer = async () => {
    api.runtime.onMessage.removeListener(surMessage);
    if (tabId !== null) { try { await api.tabs.remove(tabId); } catch (e) {} }
    await retablir();
    mesureEnCours = null;
    $('throttle-run').disabled = false;
    $('throttle-stop').disabled = true;
  };

  function surMessage(msg) {
    if (!msg || !msg.__fgcDiag) return;
    if (msg.kind === 'start') {
      visibilite = msg.visibility;
      $('r-visibility').textContent = msg.visibility;
      $('throttle-state').textContent = 'sequence de reclamation...';
      return;
    }
    if (msg.kind === 'claim-done') {
      dureeReclamation = msg.ms;
      $('r-claim').textContent = secondes(msg.ms) + '  (' + secondes(attendu) + ' sans bridage)';
      $('throttle-state').textContent = 'battements...';
      return;
    }
    if (msg.kind === 'tick') {
      battements.push({ at: msg.at, gap: msg.gap });
      $('r-ticks').textContent = String(battements.length);
      $('throttle-bar').style.width = Math.min(100, (msg.at / totalMs) * 100) + '%';
      const before = battements.filter((t) => t.at < SEUIL_INTENSIF_MS).map((t) => t.gap);
      const apres = battements.filter((t) => t.at >= SEUIL_INTENSIF_MS).map((t) => t.gap);
      if (before.length) $('r-before').textContent = Math.round(mediane(before)) + ' ms';
      if (apres.length) $('r-after').textContent = Math.round(mediane(apres)) + ' ms';
      $('throttle-state').textContent = Math.round(msg.at / 1000) + ' s / ' + Math.round(totalMs / 1000) + ' s';
      return;
    }
    if (msg.kind === 'done') {
      conclure();
    }
  }

  function conclure() {
    const before = battements.filter((t) => t.at < SEUIL_INTENSIF_MS).map((t) => t.gap);
    const apres = battements.filter((t) => t.at >= SEUIL_INTENSIF_MS).map((t) => t.gap);
    const medAvant = mediane(before);
    const medApres = mediane(apres);

    resultats.throttle = {
      url: PROBE_URL,
      visibilite,
      dureeReclamationMs: dureeReclamation === null ? null : Math.round(dureeReclamation),
      dureeAttendueMs: attendu,
      medianeAvantMs: medAvant,
      medianeApresMs: medApres,
      battements: battements.length,
      totalMs,
    };

    const reclamationOk = dureeReclamation !== null && dureeReclamation < SEUIL_INTENSIF_MS;
    if (!reclamationOk) {
      verdict($('r-verdict'), 'ko', 'Hypothese invalidee',
        'La sequence de reclamation ne tient pas dans le budget de cinq minutes. '
        + 'L\'objectif d\'autonomie nocturne tombe : il faut se replier sur la notification seule.');
    } else if (medApres !== null && medApres > 30000) {
      verdict($('r-verdict'), 'warn', 'Hypothese confirmee, avec la limite attendue',
        'La reclamation aboutit largement dans le budget, mais au-dela de cinq minutes de masquage '
        + 'Chrome ne reveille plus l\'onglet qu\'environ une fois par minute. La regle des cinq minutes '
        + 'par offre est donc necessaire et suffisante : au-dela, il faut fermer et reprendre plus tard.');
    } else if (medApres === null) {
      verdict($('r-verdict'), 'ok', 'Reclamation validee, seuil non atteint',
        'La sequence aboutit dans le budget. La mesure de deux minutes ne franchit pas le seuil des '
        + 'cinq minutes : relancer sur six minutes pour observer le regime intensif.');
    } else {
      verdict($('r-verdict'), 'ok', 'Hypothese confirmee',
        'La reclamation aboutit dans le budget et l\'onglet n\'a pas subi de bridage intensif '
        + 'sur la duree mesuree.');
    }

    $('throttle-state').textContent = 'termine';
    $('throttle-bar').style.width = '100%';
    majRapport();
    nettoyer();
  }

  api.runtime.onMessage.addListener(surMessage);
  mesureEnCours = { nettoyer };

  try {
    const tab = await api.tabs.create({ url: PROBE_URL, active: false });
    tabId = tab.id;
    await awaitLoad(tabId);
    await api.scripting.executeScript({
      target: { tabId },
      func: sondeThrottling,
      args: [{ totalMs, intervalMs: INTERVALLE_MS, etapesReclamation: etapes }],
    });
  } catch (e) {
    verdict($('r-verdict'), 'ko', 'Mesure impossible', String(e && e.message || e));
    $('throttle-state').textContent = 'echec';
    await nettoyer();
  }
}

/* ------------------------------------------------------- V0-3 : l'offscreen */

async function lancerOffscreen() {
  $('offscreen-run').disabled = true;
  $('offscreen-out').classList.remove('hidden');
  $('offscreen-state').textContent = 'creation du document...';
  verdict($('o-verdict'), '', 'Mesure en cours', '');

  try {
    try { await api.offscreen.closeDocument(); } catch (e) { /* aucun document ouvert */ }
    await api.offscreen.createDocument({
      url: 'probe-offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'Analyser le HTML des pages de magasin pour la veille des offres gratuites.',
    });

    $('offscreen-state').textContent = 'requetes...';
    const res = await api.runtime.sendMessage({ type: 'fgc-diag-offscreen-run' });
    try { await api.offscreen.closeDocument(); } catch (e) {}

    if (!res) throw new Error('aucune reponse du document offscreen');
    resultats.offscreen = res;

    $('o-domparser').textContent = res.domParser ? 'oui' : 'non';
    $('o-api').textContent = res.api && res.api.error
      ? 'echec : ' + res.api.error
      : `HTTP ${res.api.status} -- ${res.api.count} offres en ${res.api.ms} ms`;
    $('o-html').textContent = res.html && res.html.error
      ? 'echec : ' + res.html.error
      : `HTTP ${res.html.status} -- ${res.html.octets} octets, titre "${res.html.title}" en ${res.html.ms} ms`;
    $('o-links').textContent = res.html && res.html.error ? '--' : String(res.html.liensProduit);
    $('o-rotation').textContent = res.html && res.html.error
      ? '--'
      : (res.html.rotationDansLeTexte ? 'oui, dans le texte rendu'
        : res.html.rotationDansLeHtml ? 'oui, mais seulement dans la source (donnees JSON embarquees)'
        : 'non -- l\'API Epic reste la seule source');

    const apiOk = res.api && !res.api.error && res.api.status === 200;
    const htmlOk = res.html && !res.html.error && res.html.status === 200;

    if (res.domParser && apiOk && htmlOk) {
      verdict($('o-verdict'), 'ok', 'Hypothese confirmee',
        'Le document offscreen interroge les deux sources et analyse le HTML. '
        + (res.html.liensProduit === 0
          ? 'Aucun lien produit dans le HTML brut : la page de magasin est bien rendue cote client, '
            + 'ce qui confirme qu\'Epic doit passer par son API et non par le parsing.'
          : 'Les liens produit sont presents des le HTML brut.'));
    } else if (res.domParser && apiOk) {
      verdict($('o-verdict'), 'warn', 'Partiellement confirmee',
        'Le JSON passe, la page HTML non. Verifier les host_permissions du magasin vise.');
    } else {
      verdict($('o-verdict'), 'ko', 'Hypothese invalidee',
        'Les sources HTML ne pourront pas etre analysees automatiquement : elles devront passer '
        + 'par l\'onglet dedie en mode sentinelle.');
    }
    $('offscreen-state').textContent = 'termine';
  } catch (e) {
    verdict($('o-verdict'), 'ko', 'Mesure impossible', String(e && e.message || e));
    $('offscreen-state').textContent = 'echec';
  } finally {
    $('offscreen-run').disabled = false;
    majRapport();
  }
}

/* ------------------------------------------- V6-V7 : ce qu'il reste a mesurer */

/* Les ancres GOG, dans l'ordre de ce qu'on en sait.
 *
 * `.giveaway__title` n'est pas une supposition : c'est le selecteur que le
 * moteur utilise depuis des versions sur la vraie page (src/core/17-gog-
 * giveaway.js). Les autres sont des candidats, et la mesure dira lesquels
 * repondent -- c'est tout l'interet de mesurer plutot que de deviner. */
const ANCRES_GOG = [
  { name: 'titreGiveaway', selector: '.giveaway__title' },
  { name: 'giveawayId', selector: '#giveaway' },
  { name: 'giveawayClasse', selector: '[class*="giveaway"]' },
  { name: 'lienProduit', selector: 'a[href*="/game/"]', attr: 'href' },
];

async function lancerSonde() {
  $('sonde-run').disabled = true;
  $('sonde-out').classList.remove('hidden');
  $('sonde-state').textContent = 'lecture...';
  verdict($('s-verdict'), '', 'Mesure en cours', '');

  const out = {};

  try {
    /* Prime Gaming. Lecture PUBLIQUE et sans cookies : on cherche a savoir si
       le domaine sert encore quelque chose, pas a agir sur un compte. */
    out.prime = await queryHtml(api, {
      url: 'https://gaming.amazon.com/home',
      queries: [
        { name: 'cartesOffre', selector: '[data-a-target*="offer"], [class*="offer"]' },
        { name: 'liensLuna', selector: 'a[href*="luna.amazon"]', attr: 'href' },
      ],
      patterns: [
        { name: 'motPrime', source: 'prime gaming' },
        { name: 'motReclamer', source: 'claim|r[e\u00e9]clamer|obtenir' },
      ],
      /* La structure, pas seulement le compte. Un « 0 » obligerait a relancer
         une mesure par hypothese ; un echantillon permet d'ecrire le bon
         selecteur du premier coup. */
      samples: [
        { name: 'offres', selector: '[data-a-target], [class*="offer"], [class*="Offer"]', limit: 6 },
        { name: 'liens', selector: 'a[href*="claim"], a[href*="luna"], a[href*="/dp/"]', limit: 6 },
        { name: 'donneesEmbarquees', selector: 'script[type="application/json"], script[id]', limit: 4 },
      ],
    });

    out.gog = await queryHtml(api, {
      url: 'https://www.gog.com/',
      queries: ANCRES_GOG,
      patterns: [{ name: 'motGiveaway', source: 'giveaway|jeu offert|claim it free' }],
      samples: [
        { name: 'giveaway', selector: '[class*="giveaway"], [id*="giveaway"]', limit: 6 },
        { name: 'liensJeu', selector: 'a[href*="/game/"]', limit: 4 },
        { name: 'donneesEmbarquees', selector: 'script[type="application/json"], script[id]', limit: 4 },
      ],
    });

    resultats.sonde = out;

    const prime = out.prime || {};
    $('s-prime').textContent = prime.ok
      ? `HTTP ${prime.status} -- ${prime.bytes} octets, titre "${prime.title}" en ${prime.ms} ms`
      : `echec : ${prime.error}`;
    $('s-prime-offres').textContent = prime.ok
      ? `${(prime.results.cartesOffre || []).length} carte(s), ${(prime.results.liensLuna || []).length} lien(s) Luna`
        + `, mention « Prime Gaming » ${prime.matches.motPrime ? 'presente' : 'absente'}`
      : '--';

    const gog = out.gog || {};
    $('s-gog').textContent = gog.ok
      ? `HTTP ${gog.status} -- ${gog.bytes} octets, titre "${gog.title}" en ${gog.ms} ms`
      : `echec : ${gog.error}`;
    $('s-gog-ancres').textContent = gog.ok
      ? ANCRES_GOG.map((a) => `${a.selector} : ${(gog.results[a.name] || []).length}`).join(' | ')
      : '--';
    $('s-gog-texte').textContent = gog.ok ? (gog.matches.motGiveaway ? 'oui' : 'non') : '--';

    /* Ce que la structure montre, en une ligne lisible. Le detail complet part
       dans le rapport : c'est lui qu'on relit pour ecrire le selecteur. */
    const resume = (r) => {
      if (!r || !r.ok || !r.samples) return '--';
      return Object.entries(r.samples)
        .map(([nom, lot]) => `${nom} : ${lot.length}`)
        .join(' | ');
    };
    $('s-prime-structure').textContent = resume(prime);
    $('s-gog-structure').textContent = resume(gog);

    /* Le verdict ne tranche que ce que la mesure montre.
     *
     * Trois etats, pas deux, et la distinction n'est pas academique : une
     * LECTURE QUI ECHOUE ne dit rien du tout, tandis qu'une lecture qui
     * reussit sans rien trouver dit quelque chose. Confondre les deux ferait
     * conclure « page rendue cote client » a qui est simplement hors ligne --
     * et cette conclusion, recopiee dans ROADMAP.md, orienterait le code
     * suivant dans la mauvaise direction. */
    const primeVivant = prime.ok && prime.status === 200 && prime.bytes > 2000;
    const gogAncre = gog.ok && ANCRES_GOG.some((a) => (gog.results[a.name] || []).length > 0);

    if (!prime.ok && !gog.ok) {
      verdict($('s-verdict'), 'ko', 'Les deux lectures ont echoue',
        'Aucune des deux pages n\'a pu etre lue : ' + (prime.error || gog.error) + '. '
        + 'Ce n\'est pas un resultat sur les magasins -- c\'est un probleme de reseau, de '
        + 'host_permissions, ou d\'extension rechargee a moitie. Rien a conclure avant de relancer.');
    } else if (primeVivant && gogAncre) {
      verdict($('s-verdict'), 'ok', 'Les deux entrees sont mesurables',
        'gaming.amazon.com repond et la page GOG expose des ancres exploitables. '
        + 'Coller le rapport dans ROADMAP.md : les deux entrees peuvent passer a l\'ecriture.');
    } else if (primeVivant || gogAncre) {
      verdict($('s-verdict'), 'warn', 'Une seule des deux',
        (primeVivant ? 'gaming.amazon.com repond' : 'GOG expose des ancres')
        + ', l\'autre non. Le detail ci-dessus dit laquelle, et le rapport le garde.');
    } else if (prime.ok || gog.ok) {
      verdict($('s-verdict'), 'warn', 'Lues, mais rien d\'exploitable dans le HTML brut',
        'La ou la lecture a abouti, aucune ancre ne repond : la page est probablement rendue '
        + 'cote client, comme l\'etait store.epicgames.com en V0-3. Ce n\'est pas une fin de '
        + 'non-recevoir -- cela veut dire qu\'il faut viser une API JSON plutot que le HTML, et '
        + 'les echantillons « donneesEmbarquees » du rapport disent si elle est deja dans la page.');
    }
    $('sonde-state').textContent = 'termine';
  } catch (e) {
    verdict($('s-verdict'), 'ko', 'Mesure impossible', String((e && e.message) || e));
    $('sonde-state').textContent = 'echec';
  } finally {
    $('sonde-run').disabled = false;
    majRapport();
  }
}

/* -------------------------------------------------------------- le rapport */

function majRapport() {
  const l = [];
  const d = new Date().toISOString().slice(0, 16).replace('T', ' ');
  l.push(`Diagnostic du ${d} -- extension v${api.runtime.getManifest().version}`);
  l.push(`Navigateur : ${navigator.userAgent}`);
  l.push('');

  if (resultats.throttle) {
    const r = resultats.throttle;
    l.push('## V0-2 -- onglet de fond sous throttling');
    l.push(`URL sondee                 : ${r.url}`);
    l.push(`Visibilite dans l'onglet   : ${r.visibilite}`);
    l.push(`Sequence de reclamation    : ${r.dureeReclamationMs} ms (${r.dureeAttendueMs} ms sans bridage)`);
    l.push(`Cadence avant 5 min        : ${r.medianeAvantMs} ms (mediane)`);
    l.push(`Cadence apres 5 min        : ${r.medianeApresMs === null ? 'seuil non atteint' : r.medianeApresMs + ' ms (mediane)'}`);
    l.push(`Battements                 : ${r.battements} sur ${Math.round(r.totalMs / 1000)} s`);
    l.push('');
  }

  if (resultats.offscreen) {
    const r = resultats.offscreen;
    l.push('## V0-3 -- document offscreen');
    l.push(`DOMParser                  : ${r.domParser ? 'disponible' : 'absent'}`);
    l.push(`API agregateur             : ${JSON.stringify(r.api)}`);
    l.push(`Page de magasin            : ${JSON.stringify(r.html)}`);
    l.push('');
  }

  if (resultats.sonde) {
    const r = resultats.sonde;
    l.push('## V6-V7 -- ce qu\'il reste a mesurer');
    for (const [nom, mesure] of [['gaming.amazon.com', r.prime], ['gog.com', r.gog]]) {
      l.push(`### ${nom}`);
      if (!mesure || !mesure.ok) {
        l.push(`echec : ${(mesure && mesure.error) || 'inconnu'}`);
        l.push('');
        continue;
      }
      l.push(`HTTP ${mesure.status}, ${mesure.bytes} octets, titre « ${mesure.title} », ${mesure.ms} ms`);
      for (const [cle, lot] of Object.entries(mesure.results || {})) {
        l.push(`  ${cle} : ${lot.length}`);
      }
      for (const [cle, vrai] of Object.entries(mesure.matches || {})) {
        l.push(`  texte ${cle} : ${vrai ? 'present' : 'absent'}`);
      }
      // Les echantillons en dernier : c'est la partie qu'on relit ligne a ligne.
      for (const [cle, lot] of Object.entries(mesure.samples || {})) {
        l.push(`  -- echantillons ${cle} (${lot.length}) --`);
        for (const e of lot) l.push(`     ${JSON.stringify(e)}`);
      }
      l.push('');
    }
  }

  $('report').value = l.join('\n');
  const faites = (resultats.throttle ? 1 : 0) + (resultats.offscreen ? 1 : 0) + (resultats.sonde ? 1 : 0);
  $('report-state').textContent = `${faites} / 3 mesures`;
}

/* --------------------------------------------------------------- cablage */

$('throttle-run').addEventListener('click', lancerThrottling);
$('sonde-run').addEventListener('click', lancerSonde);
$('throttle-stop').addEventListener('click', () => { if (mesureEnCours) mesureEnCours.nettoyer(); });
$('offscreen-run').addEventListener('click', lancerOffscreen);
$('report-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('report').value);
    $('report-state').textContent = 'copie';
  } catch (e) {
    $('report-state').textContent = 'copie refusee : selectionner le texte a la main';
  }
});

majRapport();
