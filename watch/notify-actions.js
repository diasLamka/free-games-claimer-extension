/* Ce qu'une notification propose de faire, et ce qu'un clic veut dire.
 *
 * Le canal qui joint l'utilisateur le plus souvent ne servait qu'a informer :
 * le service worker ne construisait que des notifications « basic », sans
 * boutons, et aucun `onButtonClicked` n'etait enregistre.
 *
 * Module PUR, et ce n'est pas un detail de style. `onButtonClicked` ne rend
 * qu'un NUMERO de bouton. Sans une table qui dise, pour chaque genre de
 * notification, ce que chaque position signifie, le second bouton d'un rappel
 * declencherait l'action du second bouton d'une annonce -- donc une mise en
 * pause au lieu d'une reclamation, sur la notification meme qui dit que
 * l'offre se termine. C'est cette table, et elle se teste sans navigateur.
 */

/** Les genres de notification que l'extension envoie. */
export const NOTICE = Object.freeze({
  /** Une ou plusieurs offres viennent d'etre reperees. */
  OFFER: 'offer',
  /** Une offre se termine bientot et n'a pas ete traitee. */
  REMINDER: 'reminder',
  /** Quelque chose est casse. Voir watch/health.js. */
  INCIDENT: 'incident',
});

/** Ce qu'un bouton declenche. */
export const ACTIONS = Object.freeze({
  CLAIM: 'claim',
  SNOOZE: 'snooze',
  JOURNAL: 'journal',
});

/**
 * Les boutons, par genre.
 *
 * DEUX AU MAXIMUM : Chrome n'en affiche jamais davantage, et un troisieme
 * declare serait ignore en silence -- donc une action que le code croit
 * offrir et que personne ne voit.
 *
 * Le rappel n'en propose qu'un, et l'absence du second est le sujet : reporter
 * une offre qui se termine dans quelques heures, c'est la refuser en croyant
 * gagner du temps. Un bouton absent est un bouton qui ne peut pas couter un
 * jeu.
 *
 * L'incident ne mene qu'a ce qui l'explique. Le chien de garde aboie, il ne
 * repare pas : un bouton « reparer » sur une panne dont la cause est inconnue
 * serait un mensonge.
 */
const BUTTONS = Object.freeze({
  [NOTICE.OFFER]: Object.freeze([
    Object.freeze({ action: ACTIONS.CLAIM, label: 'notifyActionClaim' }),
    Object.freeze({ action: ACTIONS.SNOOZE, label: 'notifyActionSnooze' }),
  ]),
  [NOTICE.REMINDER]: Object.freeze([
    Object.freeze({ action: ACTIONS.CLAIM, label: 'notifyActionClaim' }),
  ]),
  [NOTICE.INCIDENT]: Object.freeze([
    Object.freeze({ action: ACTIONS.JOURNAL, label: 'notifyActionJournal' }),
  ]),
});

/** Les boutons d'un genre. Un genre inconnu n'en propose aucun. */
export function buttonsFor(kind) {
  return BUTTONS[kind] ? [...BUTTONS[kind]] : [];
}

/**
 * L'action derriere le bouton numero N.
 *
 * Rend null hors de la liste plutot que de retomber sur la premiere : un index
 * inattendu veut dire qu'on ne sait pas ce que l'utilisateur a voulu, et
 * agir dans le doute sur un vrai compte est precisement ce qu'on evite
 * partout ailleurs.
 */
export function actionAt(kind, index) {
  const liste = BUTTONS[kind];
  if (!liste || !Number.isInteger(index) || index < 0 || index >= liste.length) return null;
  return liste[index].action;
}
