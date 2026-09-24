/* Lire Steam et cliquer sur Steam etaient le meme interrupteur.
 *
 * La source Steam est ecrite en entier depuis la 2.22.0, et elle est la seule
 * a rendre trois choses que l'agregateur ne connait pas : la date de fin
 * EXACTE de l'offre, le type DLC, et le numero de paquet. Mais elle ne
 * s'activait qu'avec `steamAutoClaim` -- l'option qui fait CLIQUER, coupee par
 * defaut et confirmee derriere un avertissement qui cite le contrat Steam.
 *
 * Consequence : qui refuse le clic automatique -- et c'est le cas par defaut,
 * volontairement -- ne voyait de Steam que ce que GamerPower en dit, c'est-a-
 * dire des cles offertes sur des sites tiers, sans paquet, que le filtre
 * rejette. Le magasin etait dans la liste et n'y apportait rien.
 *
 * Ce fichier separe les deux questions :
 *
 *   REGARDER   une recherche publique, sans cookie, active par defaut ;
 *   CLIQUER    inchange -- coupe par defaut, et le reste.
 *
 * Et il tient la promesse ecrite de SECURITY.md, qui est la vraie contrainte :
 * « l'extension ne lit jamais un compte de sa propre initiative ». Lire les
 * possessions Steam demande les cookies de la session. Cela n'a donc lieu
 * qu'avec l'option de reclamation, qui en a besoin pour ne pas reclamer deux
 * fois -- jamais pour la simple detection.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { activeSourcesFor, claimableStoresFor, CLAIMABLE_STORES } from '../watch/sources/index.js';
import { discover, OWNED_URL, SEARCH_URL, ITEMS_URL, NAME, ASSETS_BASE, itemsUrl, steamImage } from '../watch/sources/steam.js';
import { DEFAULT_SETTINGS } from '../watch/storage.js';
import { STORES } from '../watch/offer.js';
import { KEYS } from '../watch/storage.js';
import { runCycle } from '../watch/cycle.js';
import { fakeChrome } from './fake-chrome.mjs';

const T = Date.UTC(2026, 8, 22, 12, 0, 0);
const APPID = '2000040';
const PAQUET = '1827145';

/** Les deux reponses de Steam, et la trace de ce qui a ete demande. */
function steamFactice({ possessions = null } = {}) {
  const appels = [];

  const fetchImpl = async (url, options = {}) => {
    appels.push({ url: String(url), credentials: options.credentials });

    if (String(url).startsWith(SEARCH_URL)) {
      return { ok: true, async text() { return `<a href="/app/${APPID}/" data-ds-appid="${APPID}">Space Menace</a>`; } };
    }
    if (String(url).startsWith(ITEMS_URL)) {
      return {
        ok: true,
        async json() {
          return {
            response: {
              store_items: [{
                appid: Number(APPID),
                name: 'Space Menace',
                type: 0,
                assets: { header: 'https://cdn.example/header.jpg' },
                best_purchase_option: {
                  is_free_to_keep: true,
                  free_to_keep_ends: Math.floor((T + 3 * 86400000) / 1000),
                  packageid: Number(PAQUET),
                  original_price_in_cents: 1999,
                  formatted_original_price: '19,99 EUR',
                },
              }],
            },
          };
        },
      };
    }
    if (String(url).startsWith(OWNED_URL)) {
      if (possessions === null) return { ok: false, status: 401 };
      return { ok: true, async json() { return { rgOwnedApps: possessions, rgOwnedPackages: [] }; } };
    }
    throw new Error(`hote inattendu : ${url}`);
  };

  return { fetchImpl, appels };
}

/* -------------------------------------------------- regarder n'est pas cliquer */

test('la source Steam est interrogee par defaut : le magasin cesse d\'etre decoratif', () => {
  assert.ok(DEFAULT_SETTINGS.activeSources.includes(NAME),
    'steam est dans les sources actives par defaut');
  assert.ok(activeSourcesFor(DEFAULT_SETTINGS).includes(NAME));
});

test('et la reclamation automatique reste coupee, elle', () => {
  /* La separation entiere tient dans ces trois lignes. Si l'une cede, on a
     active le clic en croyant activer la lecture -- et le contrat Steam
     prevoit la fermeture du compte sans preavis. */
  assert.equal(DEFAULT_SETTINGS.steamAutoClaim, false);
  assert.ok(!claimableStoresFor(DEFAULT_SETTINGS).includes(STORES.STEAM));
  assert.ok(!CLAIMABLE_STORES.includes(STORES.STEAM));
});

/* ------------------------------------------------- aucun compte sans geste */

test('sans l\'option, la decouverte ne touche jamais au compte', async () => {
  const { fetchImpl, appels } = steamFactice();

  await discover({ fetch: fetchImpl, now: T, withOwned: false });

  assert.ok(!appels.some((a) => a.url.startsWith(OWNED_URL)),
    'aucune requete vers les donnees du compte');
  assert.ok(!appels.some((a) => a.credentials === 'include'),
    'aucune requete avec les cookies de la session');
});

test('sans l\'option, la decouverte ne se plaint pas d\'une session absente', async () => {
  /* Elle ne l'a pas demandee : s'en plaindre remplirait le journal d'une
     erreur qui n'en est pas une, et le canari compte les echecs. */
  const r = await discover({ fetch: steamFactice().fetchImpl, now: T, withOwned: false });

  assert.deepEqual(r.errors, []);
});

test('sans l\'option, l\'offre arrive entiere : fin exacte, paquet, valeur', async () => {
  /* C'est tout l'interet de la source. GamerPower rend des cles Steam sans
     paquet et sans date de fin fiable ; celle-ci rend les deux. */
  const r = await discover({ fetch: steamFactice().fetchImpl, now: T, withOwned: false });

  assert.equal(r.offers.length, 1);
  const o = r.offers[0];
  assert.equal(o.store, STORES.STEAM);
  assert.equal(o.storeId, APPID);
  assert.equal(o.packageId, PAQUET);
  assert.equal(o.keepable, true);
  assert.equal(o.worth, '19,99 EUR');
  assert.ok(o.end, 'la date de fin exacte');
});

test('sans l\'option, « deja possede » vaut INCONNU et jamais « non »', async () => {
  /* La nuance coute un jeu si on la rate. Un « non » affirme sur un jeu deja
     acquis ferait ouvrir un onglet et consommer un jeton du plafond horaire ;
     pire, il ferait afficher « pas encore recupere » a quelqu'un qui l'a
     depuis des annees. Ne pas savoir se dit. */
  const r = await discover({ fetch: steamFactice().fetchImpl, now: T, withOwned: false });

  assert.equal(r.offers[0].alreadyOwned, null);
});

/* -------------------------------------------- avec l'option, rien ne change */

test('avec l\'option, la decouverte lit les possessions comme avant', async () => {
  const { fetchImpl, appels } = steamFactice({ possessions: [APPID] });

  const r = await discover({ fetch: fetchImpl, now: T, withOwned: true });

  assert.ok(appels.some((a) => a.url.startsWith(OWNED_URL)), 'le compte est lu');
  assert.ok(appels.some((a) => a.credentials === 'include'), 'avec les cookies de la session');
  assert.equal(r.offers[0].alreadyOwned, true);
});

test('avec l\'option, une session illisible reste une erreur signalee', async () => {
  const r = await discover({ fetch: steamFactice().fetchImpl, now: T, withOwned: true });

  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /session Steam/);
});

/* ------------------------------------------- ce que le cycle transmet */

/** Une source qui ne fait rien, sinon retenir ce qu'on lui a demande. */
function sourceEspionne(name) {
  return {
    name,
    completeList: true,
    minIntervalMs: 0,
    recu: [],
    async discover(options) { this.recu.push(options); return { offers: [], dropped: [], errors: [] }; },
  };
}

async function cycleAvec(reglages) {
  const faux = fakeChrome({ now: T });
  await faux.chrome.storage.local.set({
    [KEYS.SETTINGS]: { ...DEFAULT_SETTINGS, ...reglages },
  });

  const steam = sourceEspionne(NAME);
  await runCycle({
    chrome: faux.chrome,
    now: T,
    sources: { [NAME]: steam },
    fetch: async () => ({ ok: true, async json() { return {}; }, async text() { return ''; } }),
    claimableStores: CLAIMABLE_STORES,
  });
  return steam;
}

test('le cycle demande la lecture du compte SEULEMENT si l\'option est active', async () => {
  const sans = await cycleAvec({ steamAutoClaim: false });
  assert.equal(sans.recu.length, 1, 'la source est bien interrogee');
  assert.equal(sans.recu[0].withOwned, false, 'aucune lecture de compte par defaut');

  const avec = await cycleAvec({ steamAutoClaim: true });
  assert.equal(avec.recu[0].withOwned, true, 'l\'option la redemande');
});

test('une valeur presque vraie ne suffit pas a faire lire un compte', async () => {
  /* Meme severite que claimableStoresFor : ce qui declenche une requete
     porteuse de cookies se compare a `true`, jamais a la veracite. */
  for (const presque of ['true', 1, 'oui', {}]) {
    const s = await cycleAvec({ steamAutoClaim: presque });
    assert.equal(s.recu[0].withOwned, false, `accepte a tort : ${JSON.stringify(presque)}`);
  }
});

/* La vignette (2.61.0). Mesure du 2026-09-24 sur un vrai GetItems : `header`
   est un NOM DE FICHIER, et `asset_url_format` dit ou le poser. La requete ne
   demandait pas `include_assets` : aucune offre Steam n'avait d'image. */
test('la vignette Steam : le nom de fichier pose dans son format, sur le CDN', () => {
  const mesure = {
    asset_url_format: 'steam/apps/4355480/${FILENAME}?t=1789400832',
    main_capsule: 'ff03a4e114e53dea039335bb6927bd91723a50f5/capsule_616x353.jpg',
    header: '4f140de54ebd2306321005daaab93a2ba8fc9457/header.jpg',
    hero_capsule: '235cdf3f21f7a74c87cfd592490fa4a061cfbc06/hero_capsule.jpg',
  };
  assert.equal(steamImage(mesure),
    'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/4355480/4f140de54ebd2306321005daaab93a2ba8fc9457/header.jpg?t=1789400832');
  assert.ok(steamImage(mesure).startsWith(ASSETS_BASE));
  const { header, ...sansEnTete } = mesure;
  assert.match(steamImage(sansEnTete), /capsule_616x353\.jpg/, 'a defaut, la capsule principale');
  assert.equal(steamImage({ header: 'x/header.jpg' }), null, 'sans format, pas d\'adresse inventee');
  assert.equal(steamImage({ ...mesure, header: '../../evil.jpg' }), null);
  assert.equal(steamImage({ ...mesure, header: 'a b/header.jpg' }), null);
  assert.equal(steamImage(undefined), null);
  const requete = JSON.parse(decodeURIComponent(itemsUrl(['4355480']).split('input_json=')[1]));
  assert.equal(requete.data_request.include_assets, true, 'sans lui, Steam ne rend aucune image');
});
