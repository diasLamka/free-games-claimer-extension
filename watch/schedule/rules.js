/* Les horaires de publication connus des magasins.
 *
 * Pourquoi ce fichier existe : `clock.js` a ete ecrit pour exprimer « tous les
 * jeudis a telle heure, dans tel fuseau » sans jamais se tromper aux
 * changements d'heure -- et personne ne l'appelait jamais avec une regle.
 * `veille:calendriers` restait vide, `hotInstants` recevait toujours une liste
 * vide, et la veille ne savait de la rotation hebdomadaire que ce qu'Epic
 * voulait bien annoncer a l'avance. Sans annonce, le seul filet etait le
 * plancher de trois interrogations par jour : un drop du jeudi 17 h pouvait
 * n'etre vu que huit heures plus tard.
 *
 * CE QUE CES REGLES SONT, ET NE SONT PAS.
 *
 * Ce sont des heures de REVEIL : elles decident quand aller regarder. Elles ne
 * fabriquent aucune date de debut ni de fin, et ne remplacent jamais ce que la
 * source publie. Les fenetres annoncees par Epic restent prioritaires quand
 * elles existent ; celles-ci prennent le relais quand elles manquent.
 *
 * LE FUSEAU N'EST PAS CELUI DE L'UTILISATEUR.
 *
 * Epic publie a 11:00 heure de New York. En France cela tombe a 17:00 presque
 * toute l'annee -- mais pas les trois semaines de mars ni la semaine
 * d'octobre ou les deux continents n'ont pas encore change d'heure ensemble.
 * Ecrire « 17:00 Europe/Paris » serait donc faux deux fois par an, et faux
 * d'une heure : assez pour rater l'ouverture. La regle est donc ecrite dans le
 * fuseau ou elle est VRAIE, et `clock.js` la traduit.
 */
import { NAME as EPIC } from '../sources/epic.js';

/** Jeudi. `clock.js` compte les jours comme JavaScript : dimanche = 0. */
const THURSDAY = 4;

/**
 * Regles par defaut, par source.
 *
 * Seul Epic en a une : c'est le seul magasin dont la rotation soit connue,
 * reguliere et publique. GOG et l'agregateur ouvrent quand ils veulent, et
 * inventer un horaire pour eux ferait interroger dans le vide.
 */
export const DEFAULT_SCHEDULES = Object.freeze({
  [EPIC]: Object.freeze([
    Object.freeze({
      zone: 'America/New_York',
      dayCount: Object.freeze([THURSDAY]),
      hour: 11,
      minute: 0,
    }),
  ]),
});

/**
 * Les regles a utiliser : celles de l'utilisateur si elles existent, les
 * notres sinon, source par source.
 *
 * Une liste VIDE posee par l'utilisateur est un choix, pas une absence : on la
 * respecte. Sans cette nuance, couper la regle d'Epic serait impossible.
 */
export function schedulesWithDefaults(stored) {
  const out = { ...DEFAULT_SCHEDULES };
  for (const [source, rules] of Object.entries(stored || {})) {
    if (Array.isArray(rules)) out[source] = rules;
  }
  return out;
}
