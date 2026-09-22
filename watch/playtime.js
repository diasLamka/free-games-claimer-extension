/* Le miroir : recupere contre lance.
 *
 * L'extension sait ce que vous avez pris, et quand. Elle ne sait pas si vous y
 * avez joue -- et c'est la seule question qui retourne le produit. « 340 jeux
 * recuperes, 12 lances » ne dit pas d'en prendre plus ; cela dit de jouer a ce
 * qu'on a.
 *
 * Aucun launcher ne peut le dire, parce qu'aucun ne couvre les quatre
 * magasins. Cette extension, si -- pour la partie Steam.
 *
 * CE QU'IL FAUT DIRE TOUT DE SUITE : seul Steam expose un temps de jeu
 * lisible. GOG et Epic n'en publient aucun. Le miroir ne couvre donc qu'un
 * magasin sur quatre, et il le dit plutot que de laisser croire au contraire.
 *
 * Module PUR.
 */

/** Cle de stockage. Espace de la veille. */
export const KEY_PLAYTIME = 'veille:temps-de-jeu';

/**
 * L'adresse de la liste, pour la session en cours.
 *
 * `/my/` se resout cote serveur vers le profil connecte : aucun identifiant a
 * demander, aucun nom de profil a stocker. Le format XML est le seul que Steam
 * publie sans cle d'API.
 *
 * L'hote n'est PAS dans les permissions du manifeste : il est demande au
 * moment du geste, et retirable. Voir watch/permissions.js.
 */
export const GAMES_URL = 'https://steamcommunity.com/my/games?tab=all&xml=1';

/** L'hote a demander, en permission optionnelle. */
export const GAMES_ORIGIN = 'https://steamcommunity.com/*';

/**
 * Lit la liste des jeux et leur temps de jeu.
 *
 * PAR EXPRESSION REGULIERE, et non par analyse de document. Trois raisons, et
 * la premiere suffirait : un service worker MV3 n'a pas de DOMParser, donc
 * analyser demanderait de passer par le document hors ecran -- une piece de
 * plus dans un chemin qui n'en a pas besoin. Le format est plat et stable
 * depuis des annees, et une expression se teste sans monter un navigateur.
 *
 * `hoursOnRecord` est ABSENT pour un jeu jamais lance. C'est exactement le
 * signal recherche, et le distinguer de « zero heure » compte : zero peut
 * vouloir dire « lance deux minutes ».
 */
export function parseGamesXml(xml) {
  const texte = String(xml || '');
  const jeux = [];

  const bloc = /<game>([\s\S]*?)<\/game>/g;
  let m;
  while ((m = bloc.exec(texte)) !== null) {
    const corps = m[1];

    const appid = champ(corps, 'appID');
    if (!appid) continue;

    const heures = champ(corps, 'hoursOnRecord');
    const valeur = heures === null ? null : Number.parseFloat(heures.replace(/,/g, ''));

    jeux.push({
      appid: String(appid),
      title: champ(corps, 'name'),
      /* null = jamais lance, distinct de 0 = lance sans duree mesurable. */
      hours: Number.isFinite(valeur) ? valeur : null,
    });
  }
  return jeux;
}

/** Un champ du bloc, avec ou sans section CDATA. */
function champ(corps, nom) {
  const re = new RegExp(`<${nom}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${nom}>`);
  const m = re.exec(corps);
  return m ? m[1].trim() : null;
}

/**
 * La table appid vers heures, prete a etre stockee.
 *
 * Seuls l'identifiant et les heures sont gardes : le titre vit deja dans la
 * collection, et une bibliotheque Steam compte des milliers d'entrees -- chaque
 * champ s'y paie autant de fois.
 */
export function playtimeTable(jeux) {
  const table = {};
  for (const j of jeux || []) if (j && j.appid) table[j.appid] = j.hours;
  return table;
}

/**
 * Ce que le miroir renvoie.
 *
 * `covered` dit sur combien de jeux la reponse porte reellement. Sans lui, un
 * ratio calcule sur trois jeux connus aurait l'air aussi solide qu'un ratio
 * calcule sur trois cents -- et personne ne pourrait faire la difference.
 */
export function mirror({ library = {}, playtime = {}, minutesPlayed = 0 } = {}) {
  const seuil = minutesPlayed / 60;

  let claimed = 0;
  let covered = 0;
  let played = 0;
  let never = 0;

  for (const e of Object.values(library || {})) {
    if (!e) continue;
    claimed++;

    /* Le temps de jeu est indexe par appid Steam. Une acquisition sur un autre
       magasin n'est donc pas « jamais lancee » : elle est HORS PORTEE, et la
       confondre avec un jeu ignore accuserait l'utilisateur a tort. */
    if (e.store !== 'steam' || !e.id) continue;
    if (!Object.prototype.hasOwnProperty.call(playtime, e.id)) continue;

    covered++;
    const h = playtime[e.id];
    if (h === null || h === undefined || h <= seuil) never++;
    else played++;
  }

  return {
    claimed,
    covered,
    played,
    never,
    /* Le ratio porte sur ce qui est COUVERT, jamais sur le total. Le calculer
       sur `claimed` ferait passer trois magasins sans temps de jeu pour trois
       magasins de jeux jamais lances. */
    rate: covered ? Math.round((played / covered) * 100) : null,
  };
}
