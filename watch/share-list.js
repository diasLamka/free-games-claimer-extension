/* « Copier la liste » : les jeux gratuits du moment, a coller ailleurs (2.80.0).
 *
 * La premiere chose qu'on fait d'un jeu gratuit, apres l'avoir pris, c'est le
 * dire aux copains -- sur Discord, WhatsApp, un forum. Le bouton sous « Gratuit
 * maintenant » copie un texte pret a coller : les jeux AFFICHES (la recherche
 * et la puce de magasin comptent : on copie ce qu'on voit), leur magasin, leur
 * valeur, jusqu'a quand, et le lien. Puis, s'il y en a, ce qu'Epic annonce et
 * les week-ends gratuits de Steam.
 *
 * Du texte simple, sans balisage : Discord et WhatsApp le lisent pareil, et
 * les liens y deviennent des apercus avec la jaquette. Rien de personnel n'y
 * entre : ni ce que vous possedez, ni vos souhaits, ni vos codes.
 *
 * Module pur : tout ce qui parle une langue est injecte.
 */
import { displayTitle } from './offer.js';
import { isExtraContent } from './filters.js';

/** Au-dela, le message devient un mur : les suivants sont comptes, pas listes. */
export const MAX_GAMES = 15;
export const MAX_SOON = 5;

/** Un lien qu'on peut coller : https, sans espace. */
function lien(u) {
  return typeof u === 'string' && /^https:\/\/\S+$/.test(u) ? u : null;
}

/**
 * Le texte a copier.
 *
 * `offers` : les offres affichees, dans l'ordre affiche. `soon` : les
 * fenetres annoncees ({ title, store, start, url }). `weekends` : les
 * week-ends Steam ouverts ({ title, end, url }). `t` compose, `storeLabel`
 * nomme le magasin, `dateText` / `dayText` ecrivent un instant et un jour,
 * `worthText` la valeur d'une offre (ou null).
 */
export function composeShareList({
  offers = [], soon = [], weekends = [], now,
  t, storeLabel = (s) => s, dateText = (ms) => new Date(ms).toISOString(), dayText = dateText, worthText = () => null,
}) {
  const lignes = [t('shareHeader', dayText(now)), ''];

  for (const o of offers.slice(0, MAX_GAMES)) {
    const morceaux = [displayTitle(o.title), storeLabel(o.store) + (isExtraContent(o) ? ` · ${t('tagDlc')}` : '')];
    const valeur = worthText(o);
    if (valeur) morceaux.push(valeur);
    morceaux.push(typeof o.end === 'number' ? t('shareUntil', dateText(o.end)) : t('shareNoEnd'));
    lignes.push(`• ${morceaux.join(' — ')}`);
    const u = lien(o.url) || lien(o.resolveUrl);
    if (u) lignes.push(`  ${u}`);
  }
  if (offers.length > MAX_GAMES) lignes.push(`+${offers.length - MAX_GAMES}`);

  const bientot = soon.filter((w) => w && w.title && typeof w.start === 'number' && w.start > now).slice(0, MAX_SOON);
  if (bientot.length) {
    lignes.push('', t('shareUpcoming'));
    for (const w of bientot) {
      lignes.push(`• ${[displayTitle(w.title), w.store ? storeLabel(w.store) : null, t('shareFrom', dateText(w.start))].filter(Boolean).join(' — ')}`);
      const u = lien(w.url);
      if (u) lignes.push(`  ${u}`);
    }
  }

  const essais = weekends.filter((w) => w && w.title && typeof w.end === 'number' && w.end > now).slice(0, MAX_SOON);
  if (essais.length) {
    lignes.push('', t('shareWeekends'));
    for (const w of essais) {
      lignes.push(`• ${displayTitle(w.title)} — ${t('shareUntil', dateText(w.end))}`);
      const u = lien(w.url);
      if (u) lignes.push(`  ${u}`);
    }
  }

  return lignes.join('\n');
}
