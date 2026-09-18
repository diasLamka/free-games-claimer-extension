/* Recuperer une offre Steam -- en OPTION, coupee par defaut.
 *
 * POURQUOI C'EST UNE OPTION ET PAS LE COMPORTEMENT NORMAL. Le Steam Subscriber
 * Agreement, verifie le 2026-09-19, section 4.C : « You may not use any form
 * of scripts, bots, macros, or other non-human-controlled systems
 * ("Automation") to interact with Content and Services on Steam in any
 * manner », avec parmi les exemples « Earning rewards or progress without
 * genuine user input ». Section 4.D : Valve peut restreindre ou fermer le
 * compte, sans preavis. Le risque porte sur TOUT le compte Steam de
 * l'utilisateur ; c'est a lui de le prendre, et seulement s'il l'a demande.
 *
 * CE QUI EST MESURE (2026-09-19, page publique d'une vraie offre en cours,
 * Space Menace, forcee en anglais par `?l=english`) :
 *
 *   - le bloc d'achat porte le numero du PAQUET dans son identifiant :
 *     `game_area_purchase_section_add_to_cart_1827145` -- le meme 1827145 que
 *     `best_purchase_option.packageid` dans GetItems ;
 *   - son formulaire vise `https://store.steampowered.com/freelicense/
 *     addfreelicense/`, en POST, avec `subid` = ce meme paquet : une LICENCE
 *     GRATUITE, jamais une caisse -- ce formulaire ne peut rien faire payer ;
 *   - le bouton dit exactement « Add to Account », et appelle
 *     `addToCart( 1827145)`.
 *
 * On ne clique donc que si les trois concordent. Et le succes ne se lit pas
 * sur la page : il se lit dans `dynamicstore/userdata`, ou le paquet doit
 * apparaitre dans `rgOwnedPackages`.
 *
 * Module pur, sauf `steamPageStep`, qui est INJECTEE dans la page et doit donc
 * se suffire a elle-meme : aucune reference a ce module une fois serialisee.
 */

/** La fiche d'une application, forcee en anglais : c'est la langue mesuree. */
export function steamAppUrl(appid) {
  return `https://store.steampowered.com/app/${appid}/?l=english`;
}

/** Une page de connexion Steam, ou une page de controle d'age. */
export function isSteamLoginUrl(url) {
  return /^https:\/\/(store\.steampowered\.com|steamcommunity\.com)\/login\b/i.test(String(url || ''));
}

export function isSteamAgeCheckUrl(url) {
  return /^https:\/\/store\.steampowered\.com\/agecheck\//i.test(String(url || ''));
}

/**
 * L'etape jouee DANS la page Steam.
 *
 * Injectee par chrome.scripting.executeScript : elle est serialisee, donc
 * n'utilise que ses arguments et le DOM. `doc` n'existe que pour les tests --
 * dans la page, c'est `document`.
 *
 * Elle verifie avant de cliquer, et refuse au moindre ecart :
 *   1. le bloc du paquet attendu existe ;
 *   2. son formulaire vise la licence gratuite, pour CE paquet ;
 *   3. un seul bouton dit exactement « Add to Account », sans montant.
 * Un seul clic. `dryRun` verifie tout sans cliquer : c'est ce qui permet de
 * mesurer la page reelle sans rien y faire.
 */
export function steamPageStep(packageId, dryRun, doc) {
  const d = doc || document;
  const id = String(packageId);
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  const block = d.getElementById(`game_area_purchase_section_add_to_cart_${id}`);
  if (!block) {
    const owned = d.querySelector('.game_area_already_owned');
    return { ok: false, reason: owned ? 'deja-possede' : 'bloc-absent', title: clean(d.title).slice(0, 80) };
  }

  const form = block.querySelector(`form[name="add_to_cart_${id}"]`);
  const action = form ? clean(form.getAttribute('action')).split('?')[0] : '';
  if (!/^https:\/\/store\.steampowered\.com\/freelicense\/addfreelicense\/?$/.test(action)) {
    return { ok: false, reason: 'formulaire-non-gratuit', action };
  }
  const subid = form.querySelector('input[name="subid"]');
  if (!subid || clean(subid.value) !== id) {
    return { ok: false, reason: 'paquet-different' };
  }

  const buttons = Array.prototype.slice.call(block.querySelectorAll('.game_purchase_action a, .game_purchase_action button'));
  const labels = buttons.map((b) => clean(b.textContent));
  const matches = buttons.filter((b, i) => /^add to account$/i.test(labels[i]));
  if (matches.length !== 1) {
    return { ok: false, reason: matches.length ? 'boutons-multiples' : 'bouton-introuvable', labels: labels.slice(0, 4) };
  }
  // Redondant avec le libelle exact, et voulu : un montant sur le bouton, c'est non.
  if (/\d[\d\s.,]*\s*[€$£]|[€$£]\s*\d/.test(clean(matches[0].textContent))) {
    return { ok: false, reason: 'libelle-payant' };
  }

  if (dryRun) return { ok: true, dryRun: true };
  matches[0].click();
  return { ok: true, clicked: true };
}

/** Ce que dit un refus de l'etape, en une ligne pour le journal et le canari. */
export function describeStep(step) {
  if (!step) return 'aucune reponse de la page';
  const extra = step.labels ? ` (boutons : ${step.labels.join(' | ') || 'aucun'})`
    : step.action ? ` (formulaire : ${step.action || 'absent'})`
      : step.title ? ` (page : ${step.title})` : '';
  return `${step.reason || 'refus'}${extra}`;
}

/* ------------------------------------------------------------------ rythme */

/** Deux recuperations Steam jamais plus proches que ceci. */
export const STEAM_SPACING_MS = 20 * 60 * 1000;

/** Et jamais plus de ceci par tranche de vingt-quatre heures. */
export const STEAM_MAX_PER_DAY = 6;

/**
 * Peut-on tenter une offre Steam maintenant ?
 *
 * Lent a dessein, et en plus du plafond horaire commun : UNE par cycle, vingt
 * minutes d'ecart au moins, six par jour au plus. Les offres gratuites de
 * Steam durent des jours, rien ne presse -- et Steam tient un quota
 * d'activations ou meme un « deja possede » compte comme un echec.
 *
 * Les dates viennent du catalogue (`lastAttemptAt` des offres Steam) : aucune
 * cle de plus a tenir, et une offre purgee n'a plus rien a dire du rythme.
 */
export function steamGate(catalog, now, { claimedThisRun = 0 } = {}) {
  if (claimedThisRun >= 1) return { allowed: false, reason: 'une recuperation Steam par cycle' };

  const recent = Object.values(catalog || {})
    .filter((o) => o && o.store === 'steam' && typeof o.lastAttemptAt === 'number')
    .map((o) => o.lastAttemptAt)
    .filter((t) => now - t < 24 * 3600000);

  const last = recent.length ? Math.max(...recent) : null;
  if (last !== null && now - last < STEAM_SPACING_MS) {
    return { allowed: false, reason: `derniere recuperation Steam il y a ${Math.round((now - last) / 60000)} min` };
  }
  if (recent.length >= STEAM_MAX_PER_DAY) {
    return { allowed: false, reason: `${recent.length} recuperations Steam en 24 h` };
  }
  return { allowed: true, reason: null };
}
