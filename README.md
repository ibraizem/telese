# Devlink secrétariat

Outil interne de gestion des rendez-vous pour un cabinet d'orthophonie
(**Devlink secrétariat**) : agenda partagé, patients, orthophonistes, disponibilités,
liste d'attente, génération de messages et statistiques.

> **Données de santé** : l'application ne stocke **aucune donnée médicale**
> (pas de diagnostic ni de compte rendu) — uniquement des informations
> administratives de contact.

## Stack

- **Frontend** : React 18 + React Router + Vite (compilé dans `dist/`).
- **Backend** : Node.js 20 + Express 4 (API REST + sessions httpOnly).
- **Base de données** : libSQL / [Turso](https://turso.tech) (compatible SQLite).
  En local, un simple fichier SQLite (`data/app.db`) est utilisé.
- **Hébergement** : Netlify (frontend statique + API en fonction serverless).

## Développement local

```bash
npm install
npm run seed:fresh   # données de démonstration (100 % fictives)
npm run dev          # API sur :4000 + Vite sur :5173
```

Comptes de démonstration (mot de passe : `Demo1234`) :

| Rôle           | E-mail               |
| -------------- | -------------------- |
| Administrateur | `sophie@cabinet.ma`  |
| Télésecrétaire | `imane@cabinet.ma`   |
| Orthophoniste  | `nadia@cabinet.ma`   |

En local, aucune variable d'environnement n'est nécessaire : la base est le
fichier `data/app.db` (voir `.env.example` pour les options).

## Tests

```bash
npm test        # 10 scénarios métier (API)
npm run test:ui # parcours de bout en bout (Chrome headless)
```

## Architecture

```
server/
  app.js            Application Express (partagée local + Netlify)
  index.js          Serveur longue durée (npm run dev / start)
  db.js             Couche base de données (client libSQL asynchrone)
  auth.js           Sessions, rôles/permissions, journal d'actions
  scheduling.js     Calcul des créneaux, conflits, congés
  routes/           Routes REST par domaine
netlify/
  functions/api.mjs Fonction serverless exposant l'API Express
src/                Frontend React
scripts/            Scripts de test
```

> **Note technique** : l'accès à la base est **asynchrone**
> (`await db.prepare(sql).get(...)`). Les routes utilisent le routeur
> `server/async-router.js`, qui propage les erreurs des handlers `async`
> vers Express (Express 4 ne le fait pas nativement).

## Déploiement (Netlify + Turso)

Les fonctions serverless de Netlify n'ont **pas de disque persistant** : la
base SQLite locale ne peut donc pas y être utilisée. La base est hébergée sur
Turso.

### 1. Créer la base Turso

```bash
# Installer la CLI Turso : https://docs.turso.tech/cli/installation
turso auth login
turso db create devlink-secretariat
turso db show devlink-secretariat --url        # → TURSO_DATABASE_URL
turso db tokens create devlink-secretariat     # → TURSO_AUTH_TOKEN
```

Puis, pour charger les données de démonstration dans la base distante :

```bash
TURSO_DATABASE_URL="libsql://…" TURSO_AUTH_TOKEN="…" npm run seed:fresh
```

### 2. Créer le site Netlify

- Nouveau site → importer le dépôt GitHub.
- Build command : `npm run build` — Publish directory : `dist`
  (déjà défini dans `netlify.toml`).

### 3. Variables d'environnement (Netlify → Site settings → Environment)

| Variable             | Valeur                                   |
| -------------------- | ---------------------------------------- |
| `TURSO_DATABASE_URL` | URL `libsql://…` de la base              |
| `TURSO_AUTH_TOKEN`   | jeton créé à l'étape 1                   |
| `NODE_ENV`           | `production` (cookie de session `Secure`)|

L'API est servie sur `/api/*` (réécriture vers
`/.netlify/functions/api/:splat`, voir `netlify.toml`), donc les cookies de
session restent sur le même domaine que le frontend.
