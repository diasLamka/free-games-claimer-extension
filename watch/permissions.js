/* Les permissions qu'on demande APRES l'installation, et jamais avant.
 *
 * L'extension n'avait aucune infrastructure pour cela : pas de clef
 * `optional_permissions` dans les deux manifestes, pas un seul appel a
 * `permissions.request`, et la note du popup disait « seulement tant que
 * Chrome est ouvert » en dur.
 *
 * Une permission optionnelle se demande sur un GESTE, et elle se retire aussi
 * facilement qu'elle s'accorde. C'est ce qui la distingue d'une permission du
 * manifeste, que l'utilisateur ne peut qu'accepter en bloc ou refuser en
 * renoncant a l'extension.
 *
 * Module PUR : il decide de ce qui s'affiche, pas de ce qui se demande. La
 * demande elle-meme exige un geste utilisateur et vit donc dans le popup.
 */

/** Les permissions optionnelles que l'extension sait demander. */
export const OPTIONAL = Object.freeze({
  /**
   * Garder le navigateur eveille pour nous.
   *
   * Chrome seulement : Firefox ne l'implemente pas, et son manifeste ne la
   * declare donc pas. Une case a cocher qui ne ferait rien la-bas serait pire
   * qu'une case absente.
   */
  BACKGROUND: 'background',
});

/** Les trois etats possibles, du point de vue de l'interface. */
export const PERMISSION = Object.freeze({
  /** Accordee : la veille survit a la fermeture de la derniere fenetre. */
  GRANTED: 'granted',
  /** Pas accordee, mais demandable. */
  OFFERED: 'offered',
  /** La plateforme ne la connait pas. Rien a proposer. */
  UNSUPPORTED: 'unsupported',
});

/**
 * Ce que l'interface doit montrer pour la permission de fond.
 *
 * Trois etats, trois phrases, et jamais de case a cocher sur une plateforme
 * qui ignore la permission : cocher sans effet est la pire des trois
 * situations, parce qu'elle fait croire que la veille tourne.
 */
export function describeBackground({ granted = false, supported = true } = {}) {
  if (!supported) {
    return { state: PERMISSION.UNSUPPORTED, note: 'backgroundUnsupported', toggle: false };
  }
  if (granted) {
    return { state: PERMISSION.GRANTED, note: 'backgroundGranted', toggle: true };
  }
  return { state: PERMISSION.OFFERED, note: 'backgroundOffered', toggle: true };
}

/**
 * Le manifeste declare-t-il cette permission comme optionnelle ?
 *
 * Demander une permission qui n'y figure pas echoue -- silencieusement dans
 * certaines versions de Chrome, ce qui est le pire cas : la case se coche, et
 * rien ne change. On lit donc le manifeste plutot que de supposer.
 */
export function declaresOptional(manifest, permission) {
  const liste = (manifest && manifest.optional_permissions) || [];
  return liste.includes(permission);
}
