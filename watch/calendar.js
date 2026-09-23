/* L'agenda : ce que l'extension sait, la ou vous regardez quand elle dort.
 *
 * L'extension ne recupere rien quand le navigateur est ferme. Le chien de
 * garde (2.28.0) sait dire qu'une veille s'est arretee -- mais il le dit sur
 * cet ordinateur, le seul endroit ou personne ne regarde a ce moment-la.
 * L'agenda du telephone, lui, sonne partout.
 *
 * Un FICHIER .ics, et rien d'autre. Pas d'abonnement : il faudrait une
 * adresse que l'agenda interroge, donc un serveur, et le design n'en veut
 * aucun. Le prix est qu'il faut exporter de nouveau pour voir les offres
 * suivantes ; les UID sont STABLES pour que ce nouvel export mette a jour
 * les evenements au lieu de les doubler.
 *
 * Trois sortes d'evenements :
 *
 *   - la fin d'une offre en cours, une heure avant qu'elle se termine, avec
 *     un rappel la veille ;
 *   - le debut d'une offre annoncee (« Bientot ») ;
 *   - le dernier jour d'un code a echanger, en journee entiere, puisque la
 *     page d'echange ne donne qu'un jour.
 *
 * JAMAIS LE CODE LUI-MEME. Un agenda se synchronise dans un nuage, se
 * partage, s'affiche sur un ecran verrouille ; un code d'echange est une
 * valeur qui se vole. L'evenement dit quel jeu, et ou -- le code reste dans
 * l'onglet Codes. Meme l'UID ne le porte pas : il en porte une empreinte
 * courte, qui ne permet pas de le retrouver.
 *
 * Toutes les heures sont ecrites en UTC, suffixe Z : une date sans fuseau
 * serait lue dans celui de l'agenda, et la regle de la veille vaut ici aussi --
 * le fuseau d'une date se declare, il ne se devine pas.
 *
 * Module PUR : aucune API d'extension, aucune horloge. Les libelles lui sont
 * passes, pour qu'il ne sache rien de la langue choisie.
 */

/** Duree d'un evenement de fin ou de debut d'offre. */
export const EVENT_MS = 60 * 60 * 1000;

/** Domaine des UID : ce qui les distingue de ceux de tout autre programme. */
const UID_DOMAIN = 'free-games-claimer';

/** Longueur maximale d'une ligne, en OCTETS (RFC 5545, 3.1). */
const LINE_OCTETS = 75;

/* ------------------------------------------------------------ l'ecriture */

/** Un instant, en UTC : 20260923T150000Z. */
export function utcStamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Un jour, sans heure : 20260923. Le mois de 0 a 11, comme Date. */
export function dateStamp({ year, month, day }) {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10).replace(/-/g, '');
}

/** Un texte, echappe comme la RFC le demande : barre oblique, point-virgule, virgule, saut de ligne. */
export function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

function octets(cp) {
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

/**
 * Plie une ligne a 75 octets.
 *
 * En OCTETS, pas en caracteres : un titre accentue compte plus qu'il ne
 * s'affiche. Et jamais au milieu d'un caractere -- couper un « e » accentue
 * en deux laisserait l'agenda sur un octet orphelin, qu'il rendrait en
 * losange ou refuserait.
 */
export function foldLine(line) {
  const out = [];
  let courante = '';
  let taille = 0;
  // La premiere ligne a 75 octets, les suivantes 74 : l'espace de tete compte.
  let limite = LINE_OCTETS;
  for (const ch of line) {
    const n = octets(ch.codePointAt(0));
    if (taille + n > limite) {
      out.push(courante);
      courante = '';
      taille = 0;
      limite = LINE_OCTETS - 1;
    }
    courante += ch;
    taille += n;
  }
  out.push(courante);
  return out.join('\r\n ');
}

/**
 * Une empreinte courte et stable (FNV-1a, 32 bits).
 *
 * Elle sert a nommer un evenement de code sans ecrire le code : trente-deux
 * bits ne permettent pas de retrouver une cle d'une quinzaine de caracteres,
 * et suffisent a distinguer les quelques codes d'une liste.
 */
export function shortHash(value) {
  let h = 0x811c9dc5;
  for (const ch of String(value)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Ce qu'un UID peut porter sans surprise pour aucun agenda. */
function uidPart(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'x';
}

/** Une adresse web, ou rien : l'agenda en ferait un lien. */
function webLink(url) {
  return typeof url === 'string' && /^https:\/\/[^\s]+$/i.test(url) ? url : null;
}

/* ---------------------------------------------------------- les evenements */

/**
 * La fin des offres en cours.
 *
 * `offers` : [{ key, title, store, end, url }], deja filtrees par l'appelant
 * -- ce que vous possedez deja n'a rien a faire dans votre agenda. Une offre
 * sans fin connue, ou deja finie, n'y entre pas : il n'y a rien a rappeler.
 */
export function endingEvents(offers, { now, label, storeLabel = (s) => s }) {
  const out = [];
  for (const o of offers || []) {
    if (!o || typeof o.end !== 'number' || o.end <= now) continue;
    const titre = String(o.title || '').trim();
    if (!titre) continue;
    out.push({
      uid: `fin-${uidPart(o.key || titre)}@${UID_DOMAIN}`,
      start: Math.max(now, o.end - EVENT_MS),
      end: o.end,
      summary: label.ending(titre, storeLabel(o.store)),
      url: webLink(o.url),
      // La veille, puis au debut de la derniere heure.
      alarms: [
        { related: 'END', trigger: '-P1D', text: label.endingSoon(titre) },
        { related: 'START', trigger: 'PT0S', text: label.ending(titre, storeLabel(o.store)) },
      ],
    });
  }
  return out;
}

/**
 * Le debut des offres annoncees.
 *
 * `windows` : [{ start, title, store, url }], la meme liste que la section
 * « Bientot ». Une fenetre sans titre -- un jeu mystere -- entre quand meme :
 * c'est precisement celle qu'on n'a aucun autre moyen de guetter.
 */
export function upcomingEvents(windows, { now, label, storeLabel = (s) => s }) {
  const out = [];
  for (const w of windows || []) {
    if (!w || typeof w.start !== 'number' || w.start <= now) continue;
    const titre = String(w.title || '').trim() || label.mystery;
    /* Le titre fait l'UID quand il existe : si Epic decale l'heure, le
       prochain export deplace l'evenement au lieu d'en ajouter un second. Un
       jeu mystere n'a que son heure pour se distinguer. */
    const quoi = w.title ? uidPart(w.title) : `mystere-${utcStamp(w.start)}`;
    out.push({
      uid: `debut-${uidPart(w.store)}-${quoi}@${UID_DOMAIN}`,
      start: w.start,
      end: w.start + EVENT_MS,
      summary: label.starting(titre, storeLabel(w.store)),
      url: webLink(w.url),
      alarms: [{ related: 'START', trigger: 'PT0S', text: label.starting(titre, storeLabel(w.store)) }],
    });
  }
  return out;
}

/**
 * Le dernier jour des codes a echanger.
 *
 * `codes` : [{ code, title, store, day }], ou `day` est deja lu
 * ({ year, month, day }) et le code toujours en attente. Un jour deja passe
 * n'entre pas : l'onglet Codes le dit expire, l'agenda n'y peut plus rien.
 */
export function codeEvents(codes, { now, label, storeLabel = (s) => s }) {
  const out = [];
  const aujourdhui = dateStamp(dayOf(now));
  for (const c of codes || []) {
    if (!c || !c.code || !c.day) continue;
    const jour = dateStamp(c.day);
    if (jour < aujourdhui) continue;
    const titre = String(c.title || '').trim() || label.untitled;
    out.push({
      uid: `code-${shortHash(c.code)}@${UID_DOMAIN}`,
      day: c.day,
      summary: label.code(titre, storeLabel(c.store)),
      url: webLink(c.redeemUrl),
      // La veille a 9 h, heure de l'agenda : une journee entiere commence a minuit.
      alarms: [{ related: 'START', trigger: '-PT15H', text: label.code(titre, storeLabel(c.store)) }],
    });
  }
  return out;
}

function dayOf(ms) {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

function nextDay({ year, month, day }) {
  const d = new Date(Date.UTC(year, month, day + 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

/* -------------------------------------------------------------- le fichier */

/**
 * Le calendrier complet, pret a telecharger.
 *
 * Les evenements de meme UID sont dedoublonnes -- le premier gagne : un
 * agenda qui recoit deux fois le meme UID dans un fichier en garde un au
 * hasard, et le hasard n'a rien a faire ici.
 */
export function buildCalendar(events, { now, name }) {
  const lignes = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Free Games Auto-Claimer//Agenda//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
  ];
  const vus = new Set();
  for (const e of events || []) {
    if (!e || vus.has(e.uid)) continue;
    vus.add(e.uid);
    lignes.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${utcStamp(now)}`);
    if (e.day) {
      lignes.push(`DTSTART;VALUE=DATE:${dateStamp(e.day)}`, `DTEND;VALUE=DATE:${dateStamp(nextDay(e.day))}`);
    } else {
      lignes.push(`DTSTART:${utcStamp(e.start)}`, `DTEND:${utcStamp(e.end)}`);
    }
    lignes.push(`SUMMARY:${escapeText(e.summary)}`);
    if (e.url) {
      // Dans la description aussi : plusieurs agendas ignorent URL a l'import.
      lignes.push(`URL:${e.url}`, `DESCRIPTION:${escapeText(e.url)}`);
    }
    lignes.push('TRANSP:TRANSPARENT');
    for (const a of e.alarms || []) {
      const related = a.related === 'END' ? ';RELATED=END' : '';
      lignes.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(a.text)}`, `TRIGGER${related}:${a.trigger}`, 'END:VALARM');
    }
    lignes.push('END:VEVENT');
  }
  lignes.push('END:VCALENDAR');
  return `${lignes.map(foldLine).join('\r\n')}\r\n`;
}

/** Le nom du fichier, date du jour de l'export. */
export function calendarFileName(now) {
  return `free-games-claimer-${new Date(now).toISOString().slice(0, 10)}.ics`;
}
