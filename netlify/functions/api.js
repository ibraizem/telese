/**
 * Fonction serverless Netlify : expose l'application Express (`server/app.js`)
 * sous la forme d'un handler compatible AWS Lambda via `serverless-http`.
 *
 * ⚠️ Ce fichier est volontairement en **CommonJS** (cf. `./package.json`,
 * `"type": "commonjs"`).
 *
 * Netlify génère un lanceur qui fait un `require()` de l'entrée de la
 * fonction. Avec une entrée ESM (`.mjs`), Node levait `ERR_REQUIRE_ESM`
 * (`require() of ES Module … from /var/task/api.js not supported`) → HTTP 502.
 * Le chargement de l'application ESM est donc fait en différé, par `import()`,
 * qui fonctionne depuis du CommonJS.
 *
 * Netlify réécrit `/api/*` vers `/.netlify/functions/api/:splat` (voir
 * netlify.toml) ; le préfixe éventuel est retiré dans `server/app.js`.
 *
 * Variables d'environnement attendues (à définir dans Netlify) :
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, NODE_ENV=production
 */
'use strict';

let handlerPromise = null;

/** Charge (une seule fois) le serveless-http + l'application Express. */
function loadHandler() {
  if (!handlerPromise) {
    handlerPromise = Promise.all([import('serverless-http'), import('../../server/app.js')])
      .then(([serverless, appModule]) => (serverless.default || serverless)(appModule.default))
      .catch((err) => {
        handlerPromise = null; // permet une nouvelle tentative après un échec
        throw err;
      });
  }
  return handlerPromise;
}

exports.handler = (event, context) => loadHandler().then((handler) => handler(event, context));
