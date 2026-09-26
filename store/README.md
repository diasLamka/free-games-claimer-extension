# Publier l'extension

> **Pas de publication prevue** (decision du 2026-09-26, voir la table « Hors
> perimetre » de `ROADMAP.md`). Ce dossier reste pour memoire ; l'extension
> s'installe depuis le dossier du depot.

Ce dossier porte ce qu'un magasin d'extensions demande et que le code ne
contient pas : une fiche, une justification par permission, une politique de
confidentialite. Il ne part jamais dans l'archive -- `build/package.mjs`
l'ecarte explicitement.

## Fabriquer les archives

```
npm run check      # controle de non-regression, obligatoire avant publication
npm run package    # ecrit dist/free-games-claimer-{chrome,firefox}-vX.Y.Z.zip
```

Les archives sont **reproductibles** : l'horodatage interne est fige a
1980-01-01, donc deux personnes qui empaquettent le meme commit obtiennent le
meme octet et la meme empreinte SHA256. C'est ce qui permet a quelqu'un de
verifier qu'un zip publie correspond bien au code du depot.

La voie normale n'est pas manuelle : poser un tag `vX.Y.Z` declenche
`.github/workflows/release.yml`, qui refuse si le tag et `package.json` ne
disent pas la meme version, passe `npm run check`, empaquette et depose les
deux archives sur une release GitHub.

## Ce qui reste a faire a la main

Trois choses, et aucune ne peut etre automatisee sans risque.

**1. Les captures d'ecran.** Les deux magasins en exigent. Rien dans ce depot
n'en produit : il faut ouvrir le popup, la page Ma collection et le journal,
et capturer. Chrome demande du 1280x800 ou du 640x400.

**2. L'adresse de contact.** `listing-en.md` et `listing-fr.md` portent un
`<A REMPLIR>` la ou le magasin exige une adresse joignable. Personne d'autre
que vous ne peut la choisir.

**3. La soumission elle-meme.** Elle passe par un compte developpeur, des
frais uniques cote Chrome, et une relecture humaine de plusieurs jours. Le
workflow s'arrete volontairement avant : automatiser l'envoi sans relire ce
qui part fait publier une erreur plus vite, pas mieux.

## Chrome Web Store

Console : <https://chrome.google.com/webstore/devconsole>. Compte developpeur
payant, frais uniques.

Deposer `dist/free-games-claimer-chrome-vX.Y.Z.zip`. La console demande
ensuite, dans l'onglet « Confidentialite » :

- l'**objectif unique** de l'extension : la premiere phrase de
  `listing-en.md` ;
- une **justification par permission** : c'est `permissions.md`, a recopier
  champ par champ ;
- une **declaration d'usage des donnees**. Les trois cases a cocher sont
  « non » : aucune donnee n'est vendue, aucune n'est utilisee a une fin
  etrangere a l'objectif annonce, aucune n'evalue la solvabilite. Voir
  `privacy.md`.

## Firefox Add-ons

Console : <https://addons.mozilla.org/developers/>. Compte gratuit.

Deposer `dist/free-games-claimer-firefox-vX.Y.Z.zip`. Une extension chargee
depuis `about:debugging` est temporaire et disparait au redemarrage ; c'est la
signature AMO qui rend l'installation permanente, et c'est la vraie raison de
passer par ce magasin plutot que par une archive distribuee a la main.

**Un point propre a AMO, a ne pas decouvrir pendant la relecture.** Le moteur
livre, `content/free-games-claimer.js`, est **genere** : il est produit par
concatenation des 34 modules de `src/core`. AMO exige la source et les
instructions de construction de tout code genere. Le formulaire « Source
code » attend donc une archive du depot et ces trois lignes :

```
Node.js 22 ou superieur, aucune dependance a installer.
  npm run build     regenere content/free-games-claimer.js depuis src/core/*.js
  npm run check     verifie que la reconstruction est identique au bit pres
```

Le code n'est ni minifie ni obfusque : il est lisible tel quel, et la
concatenation est verifiable par le controle de non-regression ci-dessus.
