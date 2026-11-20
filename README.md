# Manif Simulator — Valbrune

Jeu de manifestation en vue à la première personne (PEGI 18), jouable dans le navigateur.
Ville, lieux et personnages **fictifs**, à Valbrune : trois cartes (boulevard des Tanneurs, quartier des Remparts, parvis de la gare).

On choisit son camp au début : **manifestant** ou **CRS**. La partie commence dans le calme,
une jauge de tension monte avec le temps et les actions de chacun, puis ça part en cacahuète.

## Lancer le jeu

```bash
npm install
npm run dev          # http://localhost:5173
```

Autres commandes :

```bash
npm run build        # build classique dans dist/
npm run build:single # un seul fichier HTML autonome dans dist-single/index.html
npm run preview      # sert le build
```

Le fichier `dist-single/index.html` s'ouvre directement dans Chrome, Edge ou Firefox, sans serveur.

## Publier sur GitHub Pages

Le site est servi depuis la branche `gh-pages`, qui ne contient que le jeu compilé en un seul fichier (`index.html`) et un fichier `.nojekyll`.
Réglage, une seule fois : **Settings › Pages › Source : Deploy from a branch**, branche `gh-pages`, dossier `/`.

Pour mettre le jeu à jour :

```bash
npm run build:single
git switch gh-pages
cp dist-single/index.html index.html
git commit -am "Mise à jour du jeu" && git push
git switch main
```

Le jeu est en ligne à `https://<compte>.github.io/<dépôt>/` environ une minute après le push.

Le build utilise des chemins relatifs (`base: './'` dans `vite.config.ts`) : aucun réglage à changer selon le nom du dépôt.
Le site est servi en HTTPS, ce qui permet aussi le plein écran et le partage natif sur téléphone.
Pour jouer à plusieurs, il suffit d'envoyer l'adresse du site (ou le lien « Partager » du salon, qui contient le code).

## Multijoueur (2 à 8 joueurs)

Menu principal : choisir son pseudo et son camp, puis :

- **Créer une partie** : le jeu affiche un code de 5 caractères (boutons « Copier » et « Partager » ; le lien partagé pré-remplit le code).
- **Rejoindre une partie** : saisir le code reçu.

Si l'hôte quitte le navigateur un instant (pour envoyer le code par message, par exemple), le jeu se réinscrit tout seul auprès du serveur de mise en relation à son retour ; côté amis, « Rejoindre » réessaie quatre fois avant d'abandonner.

Quand deux réseaux empêchent la connexion directe entre appareils (Wi-Fi d'école ou de fac, 4G, box, IPv6/NAT64…), le jeu bascule tout seul sur un relais : les messages passent par le serveur de mise en relation PeerJS lui-même, la seule connexion que ces réseaux filtrés laissent passer. `?direct=0` force le passage par le relais pour le tester.

Dans le salon, chacun peut changer de camp et se déclarer prêt ; l'hôte lance la partie quand tout le monde est prêt.
Une partie en cours ne s'arrête pas quand un joueur ouvre le menu pause. Un joueur qui part disparaît du jeu ;
si l'hôte part, la partie se termine pour tout le monde. Un joueur à terre ou interpellé revient en jeu après quelques secondes.

Fonctionnement : connexion directe entre navigateurs (WebRTC via PeerJS), sans serveur de jeu. L'identifiant de l'hôte
est dérivé du code, et c'est sa machine qui fait tourner le monde (PNJ, IA, projectiles, dégâts, tension, canon à eau) ;
les autres envoient leur position et leurs actions, et reçoivent 15 instantanés par seconde, lissés à l'affichage.
Le nombre de PNJ est réduit d'un tiers en multijoueur. Un seul joueur à la fois peut conduire le canon à eau.

Par défaut, la mise en relation passe par le serveur public gratuit de PeerJS (`0.peerjs.com`).

### Tester en local avec 2 onglets

```bash
npm run dev                  # puis ouvrir http://localhost:5173 dans deux onglets
```

Dans le premier onglet « Créer une partie », dans le second « Rejoindre une partie » avec le code.
Si le serveur public PeerJS est injoignable (réseau d'entreprise, hors ligne), lancer un serveur de mise en relation local :

```bash
npm run peer                 # serveur PeerJS sur le port 9000
# puis ouvrir http://localhost:5173/?peer=localhost:9000 dans les deux onglets
```

Le paramètre `?peer=hôte:port` fonctionne aussi avec la version en ligne et le fichier unique.

## Technique

- **three.js** (rendu), **TypeScript**, **Vite**
- **Rapier** (`@dimforge/rapier3d-compat`) : objets lancés, collisions, contrôleur de personnage, ragdolls à 9 os
- Aucun asset externe : textures (façades haussmanniennes, pavés, bitume…), modèles et **sons** sont générés par le code
  (Web Audio pour la foule, les chants, les sirènes deux tons, les détonations, le verre, les cris, l'hélicoptère ;
  synthèse vocale du navigateur pour les sommations au haut-parleur)
- Éclairage dynamique (soleil couchant puis nuit, lune, réverbères, incendies, gyrophares, projecteur d'hélicoptère), ombres,
  post-processing : bloom, flou de mouvement, grain, aberration chromatique, vignette, effets de blessure, larmes de lacrymo,
  visière du casque CRS
- Performances : PNJ rendus en *instancing* (une poignée de draw calls pour 150+ personnes), pool fixe de lumières,
  budget de ragdolls actifs, distance d'affichage et nombre de PNJ selon le réglage de qualité (basse / moyenne / haute)

## Arborescence

```
src/
  main.ts                 menu, réglages, pause
  core/platform.ts        SDK CrazyGames (pubs, sauvegarde cloud, son, invitations), sans effet ailleurs
  core/i18n.ts, en.ts     langue (anglais par défaut, français) et dictionnaire anglais
  net/                    multijoueur : liaison PeerJS et salon, actions des joueurs, synchronisation hôte → clients, avatars des joueurs
  game.ts                 boucle de jeu, objectifs, écran de fin, hélicoptère
  core/                   contexte partagé, physique (rapier), entrées clavier/souris/tactile, détection mobile, réglages, textures, utilitaires
  world/                  cartes, plan de la ville, ciel jour/nuit, construction de la rue et de la place
  meta/                   progression hors partie : sauvegarde, niveaux et gains, boutique et améliorations, défis, pubs récompensées
  destruction/            vitrines, abribus, voitures et poubelles qui brûlent, barricades, objets dynamiques
  npc/                    corps et animations (instancing), ragdolls, PNJ, IA de la foule et des CRS
  damage/                 blessures localisées (tête, torse, bras, jambes), saignement, œil, mâchoire, boiterie
  player/                 contrôleur FPS, PV, effets à l'écran, mains en vue subjective
  weapons/                projectiles, LBD, explosions, lacrymo, objets à ramasser, équipement manifestant et CRS
  vehicles/               canon à eau (conduite + tourelle)
  tension/                jauge de tension, 3 phases, sommations
  audio/                  moteur audio synthétisé
  ui/                     écrans de progression (barre du menu, boutique, défis, gains de fin de partie), HUD, jauges de vie, mini-carte, contrôles tactiles, salon multijoueur, styles
```

## Déroulement

1. **Calme** (une quinzaine de secondes) : cortège, banderoles, chants, tambours, fumigènes. CRS en ligne. Armes inutilisables.
2. **Tension** (jauge ≥ 30) : insultes, premiers jets d'objets, 3 sommations au haut-parleur. Après la dernière, LBD et lacrymo autorisés.
3. **Chaos** (jauge ≥ 65) : charges, nuages de lacrymo poussés par le vent, incendies, barricades, canon à eau, blessés au sol,
   street medics et pompiers qui évacuent.

Objectifs : **manifestant** = percer la ligne ou tenir la place 6 secondes ; **CRS** = interpeller 13 manifestants (8 + 5 par joueur CRS en multijoueur)

**Zone interdite** : une bande rouge peinte en travers de la rue, 10 m devant la ligne de CRS (elle recule avec la ligne). Dès qu'un manifestant joueur la franchit, à n'importe quelle phase, la police peut matraquer, menotter et tirer au LBD sans attendre les sommations, et les CRS au LBD visent d'abord l'intrus. Les lacrymos des CRS restent soumises aux sommations.

**Défense de la place** : derrière la ligne, plus un manifestant joueur s'approche de la place, plus la police est forte : coups jusqu'à 2,5 fois plus forts, jusqu'à 8 CRS à ses trousses, et plus rapides qu'un sprint sur la place, où 8 CRS de réserve montent la garde. Foncer seul ne suffit plus.

**Passerelles** : trois escaliers montent le long des façades vers une passerelle à 3 m de haut (deux côté cortège, une derrière la ligne de CRS) : on y lance par-dessus les boucliers, on y est hors de portée des matraques.

**Poussée** (dès la phase « Tension ») : un manifestant joueur collé à la ligne de CRS (moins de 6 m) la pousse, aidé par le cortège derrière lui ; les CRS debout et les joueurs CRS proches la retiennent. Les fusées et mortiers qui explosent sur la ligne ajoutent de la poussée, une charge en retire. Jauge pleine : **percée**, la ligne recule de 17 m. Au bout de trois percées, elle cède et les manifestants gagnent.
ou tenir la place 10 minutes (si 12 manifestants l'envahissent, c'est perdu). Le compteur est affiché en haut au centre.

- **Menottage** : un manifestant ne peut être menotté qu'à 50 % de vie ou moins (ou à terre, ou gazé). F lance 2 s de menottage :
  le CRS ne peut rien faire d'autre, le manifestant est à genoux, mains dans le dos, puis il est emmené vers les fourgons.
- **Jauges de vie** au-dessus des adversaires proches ou blessés ; côté CRS, elles passent en bleu quand le manifestant est menottable.
- **Canon à eau** : réservoir de 12 s de jet ; une fois vide, 1 minute de remplissage pendant laquelle il ne tire plus.
- **Données de jeu** : en haut au centre, vos coups au but, le nombre de personnes touchées et les tirs à la tête ;
  « ×N touchés » s'affiche près du viseur quand un tir touche plusieurs personnes. En bas à gauche : vos PV.
- **Vue à la 3e personne** : touche P (bouton « Vue » sur mobile, ou case dans les réglages).

Écran de fin avec les statistiques (blessés, interpellations, personnes touchées, tirs, vitrines, véhicules brûlés, dégâts estimés…).

## Progression

Tout est sauvegardé dans le navigateur (`localStorage`, clé `manif-progress-v1`), ou dans la sauvegarde cloud de CrazyGames sur leur site ; « Réinitialiser la progression » dans les Réglages remet tout à zéro.

- **Pavés d'or** (la monnaie, affichée en haut du menu) : gagnés en fin de partie (participation, victoire, éliminations, coups au but, interpellations, survie), avec les défis, à chaque niveau et avec les pubs récompensées. Un emplacement « Acheter des Pavés d'or · bientôt » est prévu, sans paiement pour l'instant.
- **Niveaux et XP** : barre dans le menu et en fin de partie. Chaque niveau rapporte des Pavés d'or ; certains débloquent des skins ou des cartes (Remparts au niveau 3, Gare au niveau 5).
- **Boutique** : tenues, têtes (casques, mais aussi haut-de-forme, sombrero, couronne, perruque afro, bicorne…), visage (lunettes, moustache, nez de clown), dos (cape, ailes d'ange, bouée canard) et skins d'armes séparés pour chaque camp (visibles par les autres joueurs en ligne), et 5 améliorations permanentes à 5 paliers, au prix croissant (munitions de départ, chargeurs, vie max, rechargement, résistance).
- **En ligne** : les améliorations sont plafonnées au palier 2 ; l'hôte peut cocher « partie équilibrée » pour les couper, ainsi que les bonus de départ.
- **Défis** : 3 quotidiens (renouvelés à minuit), 3 de la semaine (le lundi) et des succès permanents ; la récompense se récupère dans l'écran « Défis ».
- **Pubs récompensées** (5 par jour) : +50 Pavés d'or, un bonus de départ pour la prochaine partie (munitions, vie, grenades) ou les gains de fin de partie doublés. Sur CrazyGames ce sont leurs vraies pubs (SDK v3) ; ailleurs elles sont simulées (15 s, bouton « Fermer » à la fin seulement).

## CrazyGames

Sur un domaine crazygames (ou avec `?useLocalSdk=true` pour le mode test), `src/core/platform.ts` charge leur SDK v3 : bandeaux de pub sur les côtés du menu (écrans larges seulement, jamais en partie), pub entre deux parties, pubs récompensées, sauvegarde cloud, langue du compte, son coupé par le site, liens d'invitation, événements de jeu (chargement, partie en cours, victoire). Le sang est désactivé par défaut là-bas (PEGI 12). Ailleurs, tout retombe sur le navigateur.

Multijoueur sur CrazyGames : la partie est déclarée comme « room » (`room()` : boutons Rejoindre / Inviter de leurs amis tant qu'elle est ouverte), un lancement depuis leur page Multijoueur crée directement une partie, un lien d'invitation la rejoint directement, le pseudo est celui du compte CrazyGames, et « Rejouer avec le groupe » relance l'hôte sur le même code puis ramène les autres dans le même salon. Taille du salon à déclarer : 8.

Langue : choisie avec les boutons en haut du menu (rechargement de la page), sinon celle du joueur, anglais par défaut. Le texte français sert de clé ; `src/core/en.ts` donne l'anglais.

## Cartes

Même histoire sur chaque carte : le cortège descend une rue vers une place tenue par la police. Choix sous le titre du menu ; en ligne, c'est l'hôte qui choisit dans le salon.

| Carte | Ambiance | Débloquée |
|---|---|---|
| Boulevard des Tanneurs | grand boulevard haussmannien, voitures garées, fin d'après-midi (16h30) | d'emblée |
| Quartier des Remparts | rues étroites en briques et crépis, sans voitures ni arbres, à la tombée du jour (18h36) : corps à corps | niveau 3 |
| Parvis de la gare | large avenue, de nuit (21h), devant la gare, son horloge et sa grande verrière | niveau 5 |

Les largeurs de rue, hauteurs d'immeubles, couleurs et heure de départ viennent de `src/world/maps.ts` ; `layout.ts` (`setMap`) et `city.ts` placent tout en fonction de ces largeurs.

## Commandes

Les touches utilisent la position physique : ZQSD sur AZERTY, WASD sur QWERTY.

### Manifestant
| Touche | Action |
|---|---|
| ZQSD / Maj / Espace / C | se déplacer / courir / sauter / s'accroupir |
| P | vue 1re / 3e personne |
| Clic gauche (maintenir puis relâcher) | lancer tendu (plus on maintient, plus c'est fort) |
| Clic droit (maintenir) | lancer en cloche (mortier : tir en arc) |
| Molette, 1-8 | choisir l'objet : pavé, bouteille, conserve, canette, mortier, fusée, fumigène, lacrymo à renvoyer |
| E | ramasser, dépaver (maintenir sur les tas de pavés), ramasser une grenade lacrymo pour la renvoyer |
| F | monter une barricade (poubelles, barrières, palettes à proximité) ou y mettre le feu |
| X | bouclier de fortune (panneau à trouver) |
| M / K | masque / sérum physiologique |
| H | appeler un street medic (soigne et arrête le saignement) |
| I | scander un slogan ou insulter (fait monter la tension) |

### CRS
| Touche | Action |
|---|---|
| 1 2 3 4 | LBD 40 · grenades lacrymo · grenades de désencerclement · matraque |
| Clic gauche | tirer / lancer / frapper (la zone touchée à la matraque suit votre regard) |
| Clic droit | viser au LBD (zoom + point rouge) / lever le bouclier |
| R | recharger le LBD (un coup, puis rechargement) |
| G / T / V | ordres à la ligne : **charger** / avancer / tenir |
| F | menotter un manifestant affaibli (50 % de vie ou moins, à terre ou gazé) : 2 s pendant lesquelles vous ne pouvez rien faire d'autre |
| E | monter dans le canon à eau / en descendre (ZQSD conduire, souris tourelle, clic gauche arroser) |
| M / H | masque à gaz / trousse de secours |
| P | vue 1re / 3e personne |

### Mobile (Android / iOS, en paysage)
Le jeu détecte automatiquement un écran tactile et affiche les contrôles virtuels ; le clavier et la souris restent actifs sur PC.

| Geste | Action |
|---|---|
| Pouce gauche, n'importe où sur la moitié gauche | joystick (le pousser jusqu'au bord = courir) |
| Glisser sur la moitié droite | regarder / viser (on peut aussi glisser depuis FEU et Cloche) |
| Viser (CRS) | un appui pour épauler le LBD (ou lever le bouclier), un autre pour arrêter ; changer d'arme l'arrête aussi |
| FEU | tirer / lancer (maintenir pour charger un lancer) / arroser au canon à eau |
| Boutons autour de FEU | Cloche ou Viser, ramasser, saut, accroupi (bascule), objet ou arme suivant, barricade/feu, recharger, CHARGE, canon à eau, menotter |
| Pastilles en haut | pause, masque, medic, slogan, sérum, panneau / avancer, tenir, soins |
| Toucher une case de l'inventaire | choisir cet objet |

Le jeu passe en plein écran au lancement (Android ; sur iOS, « Sur l'écran d'accueil » donne le plein écran). En portrait, un message demande de tourner le téléphone.

## Réglages

Menu principal > Réglages : sensibilité, volume, champ de vision, qualité, **sang on/off**, inversion de l'axe vertical, vue à la 3e personne.
Sur un portable modeste, choisir « Basse » (pas d'ombres ni de bloom, moins de PNJ).
Sur téléphone, la qualité « Mobile » est choisie d'office : 45 manifestants, ombres 512 px, pas de bloom ni d'anticrénelage, moins de lumières et de particules.
Quelle que soit la qualité, la résolution s'adapte toute seule : elle baisse (jusqu'à 50 %) sous 45 i/s et remonte au-dessus de 57 i/s.
