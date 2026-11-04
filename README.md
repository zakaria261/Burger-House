# Burger House · Le cockpit

Application de gestion interne de **Burger House, Saint-Rambert-d’Albon**, réalisée en Next.js 16, React 19 et TypeScript. Le logo officiel, le noir et le vert de l’enseigne sont intégrés à une interface adaptative, avec navigation tactile sur mobile. La version 2 utilise la typographie système Apple sur iPhone et Mac, une barre d’onglets translucide et les conventions des interfaces iOS.

## Démarrer sur le Mac

Prérequis : Node.js 24 et npm.

```sh
npm install
npm run dev
```

Ouvrir l’adresse affichée dans le terminal, généralement http://127.0.0.1:3000. Si ce port est déjà utilisé : `npm run dev -- --port 3010`.

Pour exécuter la version optimisée :

```sh
npm run build
npm start
```

La base SQLite locale est conservée dans `.data/burger-house.sqlite`, exclue du dépôt. **Ne pas supprimer ce dossier pour conserver les données locales.** Le serveur local écoute uniquement sur la boucle locale. Cette version locale ne doit pas être exposée sur Internet sans authentification.

## Fonctionnalités

- Vue par jour, mois ou année avec choix de date, recettes, dépenses, solde et graphique.
- Registre avec recherche, filtres, mode de paiement, fournisseur ou salarié, notes et détail des achats par quantité et prix unitaire.
- Montants stockés en centimes ; total des articles vérifié sur le serveur.
- Annulation d’une écriture sans effacement de sa trace ; conservation dans les exports.
- Ajout de salariés, codes de pointage personnels, arrivée, pause, reprise et départ. Le temps net exclut les pauses, y compris lorsqu’un départ intervient pendant une pause.
- Historique des services, calcul du coût horaire estimé et export des heures.
- Cahier de service avec notes à terminer et catégories Service, À commander et Équipe.
- Objectif quotidien, historique des 300 dernières actions, exports CSV protégés contre les formules et export JSON complet sans codes de pointage.
- Démonstration et restaurant réel conservés dans des espaces distincts. Les noms et chiffres de démonstration sont fictifs. Le code des salariés de démonstration est **1234**.

Le solde affiché est `recettes encaissées − dépenses saisies`. Le coût des heures pointées est une **estimation indépendante**, pas une charge comptabilisée automatiquement : les salaires effectivement versés se saisissent dans le registre pour éviter tout double décompte. L’application n’effectue aucun calcul de paie.

Un service est attribué au jour de son commencement en heure de Paris. Les exports mentionnent les services en cours. Le montant estimé repose sur le taux horaire courant renseigné pour le salarié.

## Installer sur iPhone

Depuis l’URL HTTPS publiée, ouvrir l’app dans Safari, toucher **Partager → Sur l’écran d’accueil**, activer **Ouvrir comme app** si proposé, puis **Ajouter**. Les instructions sont aussi disponibles dans Réglages → Installer.

Le manifeste, les icônes Apple, le mode autonome, les zones de sécurité et le service worker sont inclus. La version publiée précache le shell, les scripts, les styles et les polices. Une première connexion est nécessaire ; hors réseau, la dernière vue sauvegardée sur cet appareil reste consultable et les écritures sont désactivées. Les pages de connexion et l’API ne sont pas mises en cache par le service worker. Les données déjà consultées restent dans le stockage local de l’appareil pour la consultation hors connexion.

## Hébergement

Le projet conserve le véritable compilateur **Next.js**, sans substitution de framework. `npm run build:sites` effectue un export statique Next.js puis assemble les ressources avec une API Cloudflare Worker et une base D1. La même logique métier est utilisée par l’API Next.js locale et l’API publiée.

```sh
npm run build:sites
node scripts/check-worker.mjs
```

L’export Sites est placé dans `dist/server/index.js`. Il ne modifie pas les sources des routes Next.js ; le répertoire API est écarté temporairement pendant l’export, puis restauré, même en cas d’échec. Relancer `npm run build` pour utiliser ensuite `npm start` en local.

Le manifeste `.openai/hosting.json` conserve l’identifiant du Site et le binding D1 `DB`. La migration de schéma est dans `drizzle/0000_workspace.sql`. Les bases locale et publiée sont **indépendantes** ; aucun transfert automatique n’est réalisé entre les deux.

La publication est privée et protégée par la connexion ChatGPT du propriétaire. L’API vérifie l’identité transmise par Sites. Les codes salariés confirment les pointages ; ils ne constituent pas des comptes d’accès au tableau de bord. Pour un usage collectif, le propriétaire peut utiliser un appareil partagé connecté. L’ouverture d’accès à d’autres utilisateurs doit être configurée avant un déploiement d’équipe ; ne pas rendre le Site public pour contourner l’authentification.

Chaque entrée, salarié, service et note est conservé individuellement dans la base. Les mises à jour sont transactionnelles, protégées par un numéro de version pour éviter la perte de saisies simultanées. Un identifiant de requête empêche les doublons en cas de répétition. La synchronisation vérifie la version avant de relire les enregistrements.

Les codes sont dérivés avec PBKDF2-SHA-256, un sel propre au salarié et 100 000 itérations. Après cinq erreurs, le pointage de ce salarié est verrouillé pendant quinze minutes, avec un compteur conservé en base.

## Vérification

```sh
npm run check
npm test
npm run build
npm run build:sites
node scripts/check-worker.mjs
```

Les tests vérifient les pauses, les doubles arrivées, les montants, les annulations, les conflits de version, les requêtes répétées, les exports et la séparation des données. Le contrôle du Worker utilise une base SQL réelle en mémoire pour vérifier l’API et les ressources de l’artefact publié.

Le rendu visuel sur un iPhone physique et l’installation depuis Safari restent à vérifier sur l’appareil final. Aucun navigateur de test n’était connecté à la session de réalisation.

## Interface iPhone · version 2

- Police système `-apple-system` : San Francisco sur iPhone et Mac, sans téléchargement ni redistribution de fichiers de police Apple.
- Grand titre qui laisse place à une barre de navigation compacte pendant le défilement.
- Navigation à cinq onglets : Résumé, Activité, Équipe, Notes et Réglages. Actions de création séparées de la navigation.
- Apparence claire, sombre ou automatique, conservée sur l’appareil ; couleurs et sélecteurs natifs suivent le thème.
- Feuilles modales avec transition d’ouverture et de fermeture, glissement vers le bas pour fermer sur mobile, focus piégé et touche Échap sur clavier.
- Graphique interactif au toucher, à la souris et au clavier. Les valeurs de la période sont issues des écritures sauvegardées.
- Zones de sécurité iPhone, champs de 16 px pour éviter le zoom automatique, barre d’onglets masquée à l’ouverture du clavier.
- Les préférences de réduction des animations et de transparence sont respectées. Les retours vibratoires utilisent uniquement l’API disponible sur l’appareil ; ils ne sont pas garantis sur Safari iOS.
- Les symboles d’interface SVG sont des dessins originaux cohérents avec les conventions iOS. Aucun fichier SF Symbols n’est embarqué. La marque Apple est utilisée dans les instructions d’installation pour identifier l’iPhone et l’iPad ; Burger House conserve sa propre identité.

Le dépôt GitHub contient le code, les tests, les migrations et les ressources publiques. Les bases `.data/`, les exports et les secrets restent exclus. Le workflow GitHub Actions vérifie les tests métier, TypeScript, la compilation Next.js et l’artefact Worker.

Logo : [site officiel Burger House](https://bhouse26.fr/template/576_logo.jpg). Références de conception : [typographie Apple](https://developer.apple.com/design/human-interface-guidelines/typography), [navigation par onglets](https://developer.apple.com/design/human-interface-guidelines/tab-bars) et [matériaux](https://developer.apple.com/design/human-interface-guidelines/materials).
