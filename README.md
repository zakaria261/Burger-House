# Burger House · Le cockpit

Application interne Next.js, React et TypeScript pour Burger House à Saint-Rambert-d’Albon. Interface adaptée à l’iPhone, installable sur l’écran d’accueil, police système Apple, modes clair et sombre.

## Données réelles uniquement

La version 3 ne contient aucun mode de démonstration et n’injecte ni chiffre d’affaires, ni dépense, ni salarié, ni note. Un restaurant neuf commence avec un registre vide et aucun objectif quotidien. Les écrans se remplissent avec les saisies enregistrées par le responsable. L’app ne lit pas automatiquement une caisse ou un compte bancaire externe.

- Recettes et dépenses détaillées par jour, mois et année, catégories, fournisseurs, quantités et prix unitaires.
- Ajout des salariés avec code personnel, début de service, pauses, reprise et départ.
- Cahier de service, objectif à définir, exports CSV et sauvegarde JSON sans codes de pointage.
- Annulation d’une écriture sans suppression de sa trace.

Les montants sont stockés en centimes. Le solde est `recettes encaissées − dépenses saisies`. Le coût horaire des pointages est une estimation distincte : il ne crée pas automatiquement une dépense salariale et ne constitue pas un calcul de paie.

## Hébergement Vercel

**La base publiée est Postgres sur Neon.** SQLite n’est utilisé qu’en développement local sans configuration cloud. Aucun fichier de données n’est créé sur le système de fichiers de Vercel.

Les données sont conservées côté serveur et partagées entre les appareils autorisés. Les transactions, les numéros de version et les identifiants de requête protègent les saisies simultanées et les répétitions de requêtes.

Les fonctions Vercel et la base sont situées dans la région de Francfort. Le pool Postgres utilise `@vercel/functions` pour gérer son cycle de vie sur Vercel Fluid Compute.

### Variables serveur

Configurer ces variables dans le projet Vercel :

```text
DATABASE_URL                 Connexion Postgres poolée
NEON_AUTH_BASE_URL           URL Managed Better Auth du restaurant
NEON_AUTH_COOKIE_SECRET      Secret aléatoire d’au moins 32 caractères
ADMIN_EMAILS                 Adresses autorisées séparées par des virgules
```

`DIRECT_DATABASE_URL` est réservé aux migrations, dans un fichier `.env.local` exclu de Git. Aucun secret ne doit être préfixé par `NEXT_PUBLIC_`.

### Migrations

Le schéma Postgres est versionné dans `migrations/postgres/`. Appliquer les migrations avant de publier une nouvelle version nécessitant un changement de schéma :

```sh
npm run db:migrate
```

Le script utilise la connexion directe, une transaction et un verrou. Il refuse une migration déjà appliquée dont le contenu aurait changé. Aucune migration n’est exécutée au cours des requêtes utilisateur.

### Accès privé

L’accès passe par un code à usage unique envoyé à l’adresse autorisée du responsable. Les comptes autorisés sont provisionnés dans Neon Auth ; l’inscription publique est désactivée. Les routes de données vérifient la session, l’adresse autorisée et sa vérification avant tout accès à Postgres.

Les codes personnels des salariés servent au pointage sur un appareil connecté au compte responsable. Ils ne donnent pas accès aux finances depuis un compte distinct.

L’envoi des codes utilise le fournisseur email configuré dans Neon Auth. Un fournisseur SMTP dédié est à configurer pour l’exploitation courante, selon les [recommandations Neon](https://neon.com/docs/auth/production-checklist).

Une API indisponible et une véritable coupure réseau sont signalées séparément. Une absence de configuration renvoie un diagnostic explicite, sans repli vers une fausse base ou des données d’exemple.

## Démarrer en local

Prérequis : Node.js 24 ou ultérieur.

```sh
npm install
npm run dev
```

Sans variables cloud, la version locale écoute sur `127.0.0.1` et conserve les saisies dans `.data/burger-house.sqlite`. Ce dossier n’est jamais envoyé à GitHub ou Vercel. Pour utiliser le backend publié en local, configurer `.env.local` et autoriser temporairement localhost dans Neon Auth.

Les bases SQLite locale, Postgres et D1 sont indépendantes. Les données d’une ancienne installation ne sont pas fusionnées automatiquement. La version Vercel n’accède pas à la base SQLite de votre Mac.

## Installation sur iPhone

Ouvrir l’adresse HTTPS dans Safari, puis **Partager → Sur l’écran d’accueil → Ajouter**. Les instructions figurent également dans les réglages de l’app. Après une première connexion réussie, la dernière vue enregistrée sur cet appareil reste consultable hors connexion. Les nouvelles saisies nécessitent le réseau. La déconnexion efface la copie locale des données du compte.

Le manifeste, les icônes Apple, les zones de sécurité et le service worker sont inclus. Les endpoints API et d’authentification ne sont jamais mis en cache par le service worker.

## Vérifications

```sh
npm run check
npm test
npm run build
```

Le test d’intégration Postgres nécessite une branche de test séparée, une connexion directe et l’indicateur `BURGER_HOUSE_TEST_DATABASE=1`. Il crée puis retire son propre schéma isolé ; aucune donnée d’exemple n’est insérée dans le restaurant de production.

```sh
node --env-file=.env.database-test --import tsx --test tests/postgres.test.ts
```

Le dépôt conserve aussi le packaging historique Sites / Cloudflare D1 :

```sh
npm run build:sites
node scripts/check-worker.mjs
```

Cette sortie est distincte du déploiement Next.js sur Vercel. Le workflow GitHub Actions vérifie les tests, TypeScript et les deux compilations.

Le rendu et l’installation sur un iPhone physique restent à vérifier sur l’appareil final ; aucun navigateur de test n’était connecté à la session de réalisation.

Logo : [Burger House](https://bhouse26.fr/template/576_logo.jpg). Typographie système et symboles d’interface SVG originaux. Aucun fichier de police Apple ni fichier SF Symbols n’est redistribué.
