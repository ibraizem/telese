/**
 * Fonction serverless Netlify : expose l'application Express (`server/app.js`)
 * sous la forme d'un handler compatible AWS Lambda via `serverless-http`.
 *
 * Netlify réécrit `/api/*` vers `/.netlify/functions/api/:splat` (voir
 * netlify.toml) ; le préfixe éventuel est retiré dans server/app.js.
 *
 * Variables d'environnement attendues (à définir dans Netlify) :
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, NODE_ENV=production
 */
import serverless from 'serverless-http';
import app from '../../server/app.js';

export const handler = serverless(app);
