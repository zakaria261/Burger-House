# Burger House · Le cockpit

Application interne Next.js, React et TypeScript pour Burger House à Saint-Rambert-d’Albon. Interface adaptée à l’iPhone, installable sur l’écran d’accueil, police système Apple, modes clair et sombre.

## Données réelles uniquement

La version 3 ne contient aucun mode de démonstration et n’injecte ni chiffre d’affaires, ni dépense, ni salarié, ni note. Un restaurant neuf commence avec un registre vide et aucun objectif quotidien. Les écrans se remplissent avec les saisies enregistrées par le responsable. L’app ne lit pas automatiquement une caisse ou un compte bancaire externe.

- Recettes et dépenses détaillées par jour, mois et année, catégories, fournisseurs, quantités et prix unitaires.
- Ajout des salariés avec code personnel, début de service, pauses, reprise et départ.
- Cahier de service, objectif à définir, exports CSV et sauvegarde JSON sans codes de pointage.
- Annulation d’une écriture sans suppression de sa trace.

Les montants sont stockés en centimes. Le gain net mis en avant est `recettes encaissées − dépenses saisies`. Le coût horaire des pointages est une estimation distincte : il ne crée pas automatiquement une dépense salariale et ne constitue pas un calcul de paie.

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

L’accès passe par un code à usage unique envoyé à l’adresse autorisée du responsable. Les comptes autorisés sont provisionnés dans Neon Auth ; l’inscription publique est désactivée. Après vérification du code, un identifiant d’appareil opaque est conservé dans un cookie `__Host-` HttpOnly, Secure, SameSite=Lax. Seule son empreinte est stockée dans Postgres. Cette session reste valable jusqu’à la déconnexion volontaire ou la révocation ; le cookie est renouvelé à chaque visite (400 jours de conservation demandés au navigateur). L’expiration de la session OTP ne déconnecte plus l’appareil. Les routes de données vérifient la session et l’adresse autorisée à chaque accès. iOS ou le navigateur peuvent néanmoins supprimer les données du site ; une nouvelle connexion devient alors nécessaire. La déconnexion révoque la session serveur, annule les notifications de cet appareil et efface les cookies et la copie locale.

Les codes personnels des salariés servent au pointage sur un appareil connecté au compte responsable. Ils ne donnent pas accès aux finances depuis un compte distinct.

L’envoi des codes utilise le fournisseur email configuré dans Neon Auth. Un fournisseur SMTP dédié est à configurer pour l’exploitation courante, selon les [recommandations Neon](https://neon.com/docs/auth/production-checklist).

Une API indisponible et une véritable coupure réseau sont signalées séparément. Une absence de configuration renvoie un diagnostic explicite, sans repli vers une fausse base ou des données d’exemple.

## Pointages oubliés et corrections

Dans **Équipe → Ajouter un pointage**, le responsable peut enregistrer un service oublié. Le crayon de chaque ligne permet de corriger l’arrivée, le départ et les pauses, ou de terminer un service resté ouvert. Les horaires sont interprétés en heure de Paris ; les heures ambiguës au changement d’heure demandent de choisir le passage. Les chevauchements, horaires futurs et pauses trop longues sont refusés côté serveur.

Un motif est obligatoire. Chaque pointage conserve ses versions avant/après, l’auteur et l’horodatage dans son propre historique, y compris après la rotation du journal général. La correction recalcule les heures et leur coût estimé. Pour un service encore en pause, le champ représente les pauses déjà terminées ; en fermant ce service, il représente le total des pauses.

## Notifications de Douwi

Web Push envoie les arrivées, pauses, reprises et départs aux téléphones abonnés de **Douwi**, selon les préférences de chacun. L’adresse du destinataire reste vide tant qu’elle n’a pas été fournie : aucun autre responsable ne reçoit ces notifications par défaut.

Configurer côté serveur `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (URL HTTPS de l’app) et `PUSH_RECIPIENT_EMAIL`. Générer une seule paire VAPID avec `web-push.generateVAPIDKeys()` et garder la clé privée hors de Git. Quand Douwi donne son adresse : provisionner son compte vérifié dans Neon Auth, l’ajouter à `ADMIN_EMAILS`, définir `PUSH_RECIPIENT_EMAIL` sur cette même adresse, puis redéployer. Les clés VAPID sont déjà configurées sur Vercel ; le destinataire attend son adresse.

Douwi se connecte ensuite sur son téléphone et choisit **Réglages → Activer sur ce téléphone**. Sur iPhone : iOS 16.4 minimum, app ouverte depuis l’écran d’accueil, puis autorisation du système. Un bouton permet d’envoyer un test et les préférences permettent de choisir les événements. [Documentation Apple / WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

Le pointage et sa notification sont enregistrés dans la même transaction Postgres. L’envoi s’exécute après la réponse HTTP. Une erreur réseau conserve la notification pour une nouvelle tentative lors d’une requête authentifiée suivante (six tentatives maximum, bail de deux minutes). Ce mécanisme ne possède pas de tâche planifiée indépendante : sans nouvelle visite après un échec, la tentative attend. Les abonnements expirés sont supprimés ; une correction manuelle ne produit pas une fausse notification d’arrivée. Aucun ancien pointage n’est envoyé à l’activation d’un téléphone. La livraison dépend aussi du réseau, des autorisations et des modes de concentration du téléphone.

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
