/* Le tour d'inspection : regarder si quelque chose est casse, et le dire.
 *
 * Ce module existe SEPAREMENT du cycle, et c'est la decision centrale du chien
 * de garde. La panne la plus grave est celle ou la veille cesse de tourner ;
 * un detecteur qui vivrait dans le cycle ne se declencherait jamais pour
 * elle. Un chien de garde qui dort avec le chien qu'il garde ne garde rien.
 *
 * Il ne lit donc que de l'etat PERSISTE, et ne demarre rien. Cote extension il
 * est appele depuis `ensureSchedule`, que l'alarme filet periodique reveille
 * -- alarme qui existait deja, et dont la propriete de survivre a la mort du
 * service worker etait deja payee.
 *
 * Tout ce qui touche a la plateforme est injecte : `notify`, `setBadge`,
 * `record`, et jusqu'au niveau de permission. C'est ce qui le rend jouable de
 * bout en bout dans les tests, comme le cycle.
 *
 * Conception : docs/specs/2026-09-22-chien-de-garde-design.md
 */
import { KEY_CANARY } from './canary.js';
import { KEY_SESSIONS } from './session.js';
import {
  KEY_INCIDENTS, incidentLine, markNotified, observe, pendingNotices, reconcile,
} from './incidents.js';
import { ALERTS, badgeState, decideAlert } from './notify-policy.js';
import { NOTICE } from './notify-actions.js';
import { KEYS, readKeys, readSettings, write } from './storage.js';
import { t } from '../i18n.js';

/**
 * Regarde, dit une fois, peint le badge.
 *
 * Rend `{ incidents, opened, closed, notified }`. Aucun appel ne jette : un
 * tour d'inspection qui ferait tomber le rearmement des alarmes couterait
 * exactement la panne qu'il cherche a prevenir.
 */
export async function inspectHealth({
  chrome,
  now,
  permissionLevel = 'granted',
  notify = async () => {},
  setBadge = async () => {},
  record = () => {},
} = {}) {
  if (typeof now !== 'number') throw new TypeError('inspectHealth : "maintenant" est obligatoire');

  const raw = await readKeys(chrome, [
    KEY_CANARY, KEYS.SOURCES, KEY_SESSIONS, KEYS.STATE, KEY_INCIDENTS, KEYS.OFFERS,
  ]);
  const settings = await readSettings(chrome);
  const state = raw[KEYS.STATE] || {};

  const vus = observe({
    canary: raw[KEY_CANARY] || {},
    sources: raw[KEYS.SOURCES] || {},
    sessions: raw[KEY_SESSIONS] || {},
    state,
    watchedStores: settings.watchedStores,
    permissionLevel,
    now,
  });

  const { incidents, opened, closed } = reconcile(raw[KEY_INCIDENTS] || {}, vus, { now });

  for (const i of opened) record('warn', `incident ouvert : ${incidentLine(i)}`);
  for (const i of closed) record('info', `incident clos : ${incidentLine(i)}`);

  const aDire = pendingNotices(incidents);

  /* Le canal lui-meme est-il ouvert ?
   *
   * Un `muted` ouvert veut dire que le systeme bloque nos notifications. En
   * tenter une malgre tout ne couterait pas seulement un appel inutile : elle
   * serait marquee DITE alors qu'elle n'est arrivee nulle part, et l'alerte
   * serait perdue pour toujours, y compris apres le retour de la permission.
   *
   * On traite donc le canal coupe comme les heures calmes : silence, et rien
   * de marque. Ce qui attend partira quand la permission reviendra. */
  const canalCoupe = Boolean(incidents.muted);

  const decision = canalCoupe
    ? { notify: false, hold: true }
    : decideAlert({
      mode: settings.alertMode || ALERTS.ON,
      quiet: settings.quiet,
      now,
      count: aDire.length,
    });

  let suivant = incidents;
  let notified = 0;

  if (decision.notify) {
    const titre = aDire.length === 1
      ? t('incidentOneTitle')
      : t('incidentManyTitle', String(aDire.length));
    try {
      await notify({
        id: `incident-${now}`,
        title: titre,
        message: incidentLine(aDire[0]),
        kind: NOTICE.INCIDENT,
      });
      suivant = markNotified(incidents, aDire.map((i) => i.id), { now });
      notified = aDire.length;
    } catch (e) {
      record('warn', 'notification d\'incident impossible', e);
    }
  } else if (aDire.length && !decision.hold) {
    /* Dit sans l'avoir dit, et c'est voulu.
     *
     * `hold` faux avec des choses a dire veut dire que l'utilisateur a demande
     * le SILENCE, pas un report. Les laisser en attente ferait tout partir
     * d'un coup le jour ou il rallume les alertes -- exactement le
     * comportement que `decideAnnouncement` refuse deja pour les offres.
     *
     * Les heures calmes, elles, rendent `hold` vrai : rien n'est marque, et
     * l'alerte repart au matin. */
    suivant = markNotified(incidents, aDire.map((i) => i.id), { now });
  }

  await write(chrome, { [KEY_INCIDENTS]: suivant });

  /* Le badge, meme sans cycle : c'est le seul canal qui reste quand le systeme
     refuse nos notifications, et le peindre seulement en fin de cycle le
     rendrait muet dans le cas ou il sert le plus. */
  try {
    await setBadge(badgeState({
      mode: settings.badgeMode,
      unseen: state.unseen || 0,
      offers: Object.values(raw[KEYS.OFFERS] || {}),
      now,
      incidents: suivant,
    }));
  } catch (e) { /* le badge est un bonus */ }

  return { incidents: suivant, opened, closed, notified };
}
