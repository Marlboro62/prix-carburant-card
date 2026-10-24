# Carte Prix Carburant

Carte Lovelace pour Home Assistant qui affiche les **prix de vos stations-service** : un comparatif de vos stations sur votre carburant favori, un prix par carburant avec une couleur selon sa tranche de prix, l'évolution depuis le dernier changement, l'historique des 30 derniers jours, le coût d'un plein réglable et les ruptures de stock.

Elle est conçue pour l'intégration **[Prix Carburant](https://github.com/Aohzan/hass-prixcarburant)** (données officielles prix-carburants.gouv.fr) et trouve vos stations toute seule, quelle que soit l'enseigne. Pour une autre source, les capteurs peuvent être choisis à la main.

Elle a le même style que la [Carte Enedis Linky New](https://github.com/Marlboro62/content-card-linky-new), mais elle est **indépendante** : type `custom:prix-carburant-card`, ressource à part.

🎮 **[Essayer la démo en ligne](https://marlboro62.github.io/prix-carburant-card/docs/demo.html)** : la vraie carte avec des données simulées, sans installer Home Assistant.

| Bleu nuit | Clair | Autre station, plein en SP98 de 55 L (téléphone) |
| --- | --- | --- |
| ![Bleu nuit](images/station-sombre.png) | ![Clair](images/station-clair.png) | ![Rupture](images/rupture-telephone.png) |

*Aperçus avec trois stations fictives, des prix et un historique simulés.*

## Ce que la carte affiche

- **En-tête** : logo de l'enseigne, nom, adresse et distance de la station affichée, et une **pastille** qui indique quand la station a mis ses prix à jour (orange au-delà de 3 jours).
- **Comparatif de vos stations** (dès 2 stations) : le prix de votre **carburant favori** dans chaque station, de la moins chère à la plus chère, avec l'écart en centimes (« non vendu » ou « rupture » si besoin). Touchez une station pour afficher ses prix.
- **Une tuile par carburant** (Gazole, SP95, SP95-E10, SP98, E85, GPLc) :
  - le prix au millième, avec la couleur habituelle du carburant ;
  - une **pastille de couleur** selon la tranche de prix (réglable, voir [Tranches de couleur](#tranches-de-couleur)) ;
  - l'**écart avec le prix précédent**, en centimes (▲ hausse, ▼ baisse) ;
  - **« Rupture depuis… »** quand la station est en rupture de stock ;
  - une étoile **★** sur votre carburant favori, toujours en tête ;
  - un badge **€** sur le carburant le moins cher de la station.
- **Coût d'un plein** : choisissez le **carburant du plein** et la **capacité du réservoir** (− / +, par 5 L) directement dans la carte. Ces deux choix sont retenus sur l'appareil.
- **Évolution du prix** sur 30 jours du carburant choisi (touchez une tuile), avec le minimum, le maximum et les limites des tranches de couleur.

Un appui sur la pastille, le plein ou la courbe ouvre la fiche du capteur.

## Installation

### Avec HACS (recommandé)

1. Dans HACS, menu **⋮** → **Dépôts personnalisés**.
2. Ajoutez `https://github.com/Marlboro62/prix-carburant-card` avec le type **Tableau de bord** (Dashboard).
3. Cherchez **Carte Prix Carburant**, installez-la, puis rechargez la page (Ctrl+F5).

### Manuellement

1. Téléchargez [`prix-carburant-card.js`](https://raw.githubusercontent.com/Marlboro62/prix-carburant-card/main/prix-carburant-card.js) (clic droit → Enregistrer sous) et copiez-le dans `/config/www/`.
2. **Paramètres → Tableaux de bord → ⋮ → Ressources → Ajouter une ressource** :
   - URL : `/local/prix-carburant-card.js`
   - Type : **Module JavaScript**
3. Rechargez la page (Ctrl+F5).

## Configuration

Rien d'obligatoire : la carte affiche toutes les stations de l'intégration Prix Carburant.

```yaml
type: custom:prix-carburant-card
favorite: gazole
tank: 50
```

Pour comparer d'autres stations, ajoutez-les dans l'intégration (**Paramètres → Appareils et services → Prix Carburant → Configurer**), puis cochez celles à afficher dans l'**éditeur visuel** (champ `stations`).

| Option | Rôle | Défaut |
| --- | --- | --- |
| `stations` | Stations affichées : identifiants (attribut `station_id` des capteurs) | toutes |
| `title` | Titre de la carte (avec une seule station) | nom de la station |
| `favorite` | Carburant favori : en tête, marqué ★, comparé entre les stations | — |
| `fuels` | Carburants affichés, dans l'ordre : `gazole`, `sp95`, `e10`, `sp98`, `e85`, `gplc` | tous |
| `levels` | Tranches de couleur des prix (voir ci-dessous) | 5 tranches |
| `show_tank` | Afficher le coût d'un plein | `true` |
| `tank` | Capacité du réservoir par défaut, en litres (modifiable dans la carte) | `50` |
| `tank_fuel` | Carburant du plein par défaut (modifiable dans la carte) | le favori |
| `days` | Durée de l'historique (2 à 90 jours) | `30` |
| `show_chart` | Afficher l'évolution du prix | `true` |
| `theme` | `v2` (bleu nuit MyElectricalData), `auto` (clair ou sombre selon HA), `ha` (thème Home Assistant) | `v2` |
| `entities` | Capteurs choisis à la main (voir ci-dessous) | — |

Un exemple complet est dans [`exemples/carte-carburant.yaml`](exemples/carte-carburant.yaml).

### Tranches de couleur

La pastille de chaque prix, le comparatif et les lignes de la courbe prennent la couleur de la tranche du prix :

| Tranche | Couleur | Code hex |
| --- | --- | --- |
| moins de 1,00 € | 🟢 Vert | `#4CAF50` |
| 1,00 à 1,50 € | 🟠 Orange | `#FF9800` |
| 1,50 à 2,00 € | 🟣 Violet | `#9C27B0` |
| 2,00 à 2,50 € | 🩷 Magenta | `#E91E63` |
| 2,50 € et plus | 🔴 Rouge | `#F44336` |

Pour les changer, donnez vos tranches dans `levels:`. Chacune s'applique jusqu'à son prix `max`, exclu ; au-delà de la dernière, sa couleur reste.

```yaml
levels:
  - { max: 1.0, color: "#4CAF50" }
  - { max: 1.5, color: "#FF9800" }
  - { max: 2.0, color: "#9C27B0" }
  - { max: 2.5, color: "#E91E63" }
  - { max: 3.0, color: "#F44336" }
```

### Capteurs choisis à la main

Pour une autre intégration, donnez la liste des capteurs de prix (en €/L). Le carburant est lu dans l'attribut `fuel_type`, ou à défaut à la fin du nom d'entité (`…_gazole`, `…_sp98`…) :

```yaml
type: custom:prix-carburant-card
title: Ma station
entities:
  - sensor.ma_station_gazole
  - sensor.ma_station_sp98
```

> L'écart avec le prix précédent et la courbe viennent de l'**historique de Home Assistant** (recorder). Après l'installation de l'intégration, ils apparaissent au premier changement de prix.

## Support

Questions et problèmes : uniquement via les [issues GitHub](https://github.com/Marlboro62/prix-carburant-card/issues).

## Voir aussi

- [Carte Enedis Linky New](https://github.com/Marlboro62/content-card-linky-new) · [Carte Linky Appareils](https://github.com/Marlboro62/linky-appareils-card) · [Carte Onduleur UPS](https://github.com/Marlboro62/onduleur-ups-card)

Si la carte vous est utile : [Buy Me a Coffee](https://buymeacoffee.com/marlboro62) · [Ko-fi](https://ko-fi.com/nothing_one)

## Licence

MIT
