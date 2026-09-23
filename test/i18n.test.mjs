/* Tests de la resolution de langue et des libelles de duree.
 *
 * Deux bugs vecus tiennent dans ce fichier :
 *
 *   - la duree affichait « 2 d 4 h » dans une interface francaise, parce que
 *     l'unite de jour etait ecrite en dur dans popup.js au lieu de passer par
 *     les tables ;
 *   - un navigateur dont l'interface n'est ni anglaise ni francaise renvoyait
 *     l'anglais, meme quand le lecteur avait declare lire le francais.
 *
 * `chrome` et `navigator` sont poses AVANT l'import : i18n.js capture `chrome`
 * au chargement du module. La langue d'interface est lue a travers une variable
 * mutable, ce qui permet d'en changer d'un test a l'autre sans recharger.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

let uiLanguage = 'en-US';

globalThis.chrome = {
  i18n: {
    getUILanguage: () => uiLanguage,
    // Vide : on teste la resolution et les tables, pas le catalogue de Chrome.
    getMessage: () => '',
  },
};

function setNavigator(languages) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { languages, language: languages[0] },
    configurable: true,
    writable: true,
  });
}

setNavigator(['en-US']);

const { t, currentLocale, setLocale, LOCALES, intlLocale } = await import('../lib/i18n.js');

test.afterEach(() => {
  setLocale(null);
  uiLanguage = 'en-US';
  setNavigator(['en-US']);
});

/* ------------------------------------------------------------ resolution */

test('la langue reglee a la main gagne sur tout le reste', () => {
  uiLanguage = 'en-US';
  setNavigator(['en-US']);
  setLocale('fr');
  assert.equal(currentLocale(), 'fr');
  assert.equal(intlLocale(), 'fr-FR');
});

test('la langue du navigateur gagne quand elle est livree', () => {
  uiLanguage = 'fr-FR';
  setNavigator(['en-US']);
  assert.equal(currentLocale(), 'fr', 'une interface francaise doit rester francaise');
});

test('une interface dans une langue non livree consulte les langues du lecteur', () => {
  // Navigateur installe en italien, lecteur francais : l'anglais par defaut
  // jetait la seule information honnete disponible. (L'exemple etait
  // l'allemand jusqu'a la 2.50.0, qui le livre.)
  uiLanguage = 'it-IT';
  setNavigator(['fr-FR', 'en-US']);
  assert.equal(currentLocale(), 'fr');
});

test('quand rien n\'est reconnu, l\'anglais reste le repli', () => {
  uiLanguage = 'it-IT';
  setNavigator(['nl-NL', 'pt-BR']);
  assert.equal(currentLocale(), 'en');
  assert.ok(LOCALES.includes('en'));
});

test('une langue du lecteur ne prime jamais sur une interface livree', () => {
  // Le choix delibere, c'est la langue dans laquelle le navigateur est installe.
  uiLanguage = 'en-US';
  setNavigator(['fr-FR']);
  assert.equal(currentLocale(), 'en');
});

/* --------------------------------------------------------------- durees */

test('les durees portent l\'unite de la langue affichee', () => {
  setLocale('fr');
  assert.equal(t('durationDaysHours', '2', '4'), '2 j 4 h', 'le jour francais s\'ecrit j');
  assert.equal(t('durationHoursMinutes', '3', '05'), '3 h 05');
  assert.equal(t('durationMinutes', '12'), '12 min');

  setLocale('en');
  assert.equal(t('durationDaysHours', '2', '4'), '2 d 4 h');
});

test('une cle absente se voit, plutot que de disparaitre', () => {
  setLocale('fr');
  assert.equal(t('cleQuiNExistePas'), 'cleQuiNExistePas');
});

test('les deux langues repondent a toutes les cles de duree', () => {
  for (const locale of LOCALES) {
    setLocale(locale);
    for (const cle of ['durationDaysHours', 'durationHoursMinutes', 'durationMinutes']) {
      assert.notEqual(t(cle, '1', '2'), cle, `${cle} manque en ${locale}`);
    }
  }
});

/* ------------------------------------------------- allemand, espagnol (2.50.0) */

test('l\'allemand et l\'espagnol sont livres, et suivis', () => {
  assert.ok(LOCALES.includes('de'));
  assert.ok(LOCALES.includes('es'));
  uiLanguage = 'de-DE';
  setNavigator(['en-US']);
  assert.equal(currentLocale(), 'de');
  assert.equal(intlLocale(), 'de-DE');
  uiLanguage = 'it-IT';
  setNavigator(['es-MX', 'en-US']);
  assert.equal(currentLocale(), 'es', 'un lecteur hispanophone sur un navigateur italien');
  assert.equal(intlLocale(), 'es-ES');
});

test('les durees ont leur unite en allemand et en espagnol', () => {
  setLocale('de');
  assert.equal(t('durationDaysHours', '2', '4'), '2 T 4 Std.');
  assert.equal(t('durationMinutes', '12'), '12 Min.');
  setLocale('es');
  assert.equal(t('durationDaysHours', '2', '4'), '2 d 4 h');
  assert.equal(t('ago', '3 h 05'), 'hace 3 h 05');
  setLocale(null);
});
