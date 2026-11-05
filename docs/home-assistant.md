# Home Assistant

L'extension peut prévenir votre Home Assistant (HA) : une lampe qui clignote
quand un jeu gratuit tombe, un capteur « jeux à prendre » sur le tableau de
bord, une annonce sur une enceinte. Rien à installer côté HA : le seul
protocole est un **webhook**, une adresse qui reçoit un message JSON.

## Ce qui part, et ce qui ne part jamais

À chaque évènement, un message JSON vers l'adresse que vous avez saisie :

| Champ | Contenu |
|---|---|
| `event` | `new_offers` (de nouveaux jeux viennent d'être annoncés), `claimed` (l'extension vient d'en prendre), `state` (l'état a changé, ou six heures ont passé), `test` (le bouton « Envoyer un essai ») |
| `at` | l'heure, ISO 8601 |
| `quiet` | `true` si vos heures calmes ou votre mode vacances sont actifs : à vous de décider si la lampe doit clignoter |
| `count` | le nombre de jeux à prendre maintenant |
| `titles` | leurs titres, séparés par des virgules |
| `next_end`, `next_end_title` | la fin de l'offre la plus pressante, et son jeu |
| `games` | jusqu'à douze jeux : `title`, `store`, `store_label`, `url`, `image`, `end`, `worth`, `wished` |
| `new` | `new_offers` seulement : les jeux qui viennent d'être annoncés |
| `claimed` | `claimed` seulement : les titres pris |
| `version` | `test` seulement : la version de l'extension |

Chaque évènement porte l'état complet (`count`, `games`…), si bien qu'une seule
lecture suffit à tenir un capteur à jour.

**Ne part jamais :** un code de rachat, un identifiant de compte, un cookie.
Seulement ce que n'importe quelle page de magasin montre. La requête part sans
cookies et ne suit aucune redirection.

**Un seul sens.** Home Assistant n'envoie rien à l'extension : un bouton « tout
récupérer » depuis la maison demanderait une porte ouverte, et le projet n'en
ouvre pas.

## 1. Créer le webhook

L'adresse est de la forme :

```
http://homeassistant.local:8123/api/webhook/UN-IDENTIFIANT-LONG-ET-SECRET
```

- **L'identifiant est le secret** : celui qui le connaît peut écrire dans votre
  automatisation. Choisissez-en un long et aléatoire (au moins 8 caractères
  `A-Z a-z 0-9 - _`, 20 ou plus de préférence).
- **http n'est accepté que sur le réseau local** (adresse privée `192.168.x.x`,
  `10.x.x.x`, `172.16-31.x.x`, `.local`, `.lan`, ou un nom sans point comme
  `homeassistant`). En dehors, il faut **https**. Avec Nabu Casa :
  `https://hooks.nabu.casa/<jeton>` est accepté.
- Un certificat auto-signé en https sera refusé par le navigateur : sur votre
  réseau, préférez http.

Dans le popup de l'extension, section **Veille**, activez **Maison : Home
Assistant**, collez l'adresse, acceptez la demande de permission (elle ne porte
que sur CET hôte), puis **Envoyer un essai**.

> Home Assistant répond « 200 » même quand aucune automatisation n'écoute cette
> adresse. « Essai envoyé » veut dire que le message est arrivé : regardez la
> **trace** de l'automatisation (Paramètres → Automatisations → la vôtre →
> Traces) pour voir qu'il a été lu.

## 2. Un capteur « jeux à prendre »

Home Assistant n'accepte qu'**un seul** lecteur par identifiant de webhook. On
le donne donc à un capteur, et les automatisations réagissent au capteur.

Dans `configuration.yaml` (le même identifiant que dans l'adresse) :

```yaml
template:
  - trigger:
      - platform: webhook
        webhook_id: "UN-IDENTIFIANT-LONG-ET-SECRET"
        allowed_methods: [POST]
        local_only: true
    sensor:
      - name: "Jeux gratuits à prendre"
        unique_id: fgc_jeux_a_prendre
        state: "{{ trigger.json.count }}"
        attributes:
          evenement: "{{ trigger.json.event }}"
          evenement_a: "{{ trigger.json.at }}"
          silence: "{{ trigger.json.quiet }}"
          titres: "{{ trigger.json.titles }}"
          prochaine_fin: "{{ trigger.json.next_end }}"
          prochaine_fin_jeu: "{{ trigger.json.next_end_title }}"
          jeux: "{{ trigger.json.games }}"
```

Puis rechargez la configuration (Outils de développement → YAML → Modèles).
L'entité s'appelle `sensor.jeux_gratuits_a_prendre` (vérifiez son identifiant
dans Paramètres → Entités).

## 3. Une lampe qui clignote au drop

```yaml
automation:
  - alias: "Jeu gratuit : la lampe clignote"
    trigger:
      - platform: state
        entity_id: sensor.jeux_gratuits_a_prendre
        attribute: evenement_a        # change à CHAQUE message
    condition:
      - condition: template
        value_template: "{{ state_attr('sensor.jeux_gratuits_a_prendre', 'evenement') == 'new_offers' }}"
      - condition: template           # pas pendant les heures calmes
        value_template: "{{ not state_attr('sensor.jeux_gratuits_a_prendre', 'silence') }}"
    action:
      - service: light.turn_on
        target:
          entity_id: light.salon
        data:
          flash: long
```

Pour dire le titre à voix haute, ajoutez une action avec le service de
synthèse vocale de votre installation et `{{ state_attr('sensor.jeux_gratuits_a_prendre', 'titres') }}`.

## 4. Il reste moins de trois heures

```yaml
automation:
  - alias: "Jeu gratuit : dernière chance"
    trigger:
      - platform: time_pattern
        minutes: "/15"
    condition:
      - condition: template
        value_template: >
          {% set fin = state_attr('sensor.jeux_gratuits_a_prendre', 'prochaine_fin') %}
          {{ fin not in [None, 'None', ''] and 0 < (as_datetime(fin) - now()).total_seconds() < 10800 }}
      - condition: template           # une fois par fenêtre, pas tous les quarts d'heure
        value_template: >
          {{ this.attributes.last_triggered is none or (now() - this.attributes.last_triggered).total_seconds() > 10800 }}
    action:
      - service: notify.notify
        data:
          title: "Dernière chance"
          message: >
            {{ state_attr('sensor.jeux_gratuits_a_prendre', 'prochaine_fin_jeu') }} finit bientôt.
```

## Ce qui n'a pas été vérifié

Le format du message, l'adresse, la permission et l'envoi sont couverts par des
tests automatiques. **Les exemples YAML ci-dessus n'ont pas été exécutés sur un
vrai Home Assistant** : leur syntaxe suit la documentation de HA, mais un nom
d'entité ou une version plus ancienne peut demander une retouche. Si un exemple
ne passe pas chez vous, la trace de l'automatisation dit pourquoi ; envoyez-la
dans un ticket du dépôt.
