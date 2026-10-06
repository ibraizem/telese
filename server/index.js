/**
 * Point d'entrée du serveur longue durée (développement et production locale).
 *
 * L'application Express elle-même vit dans `server/app.js`, partagée avec la
 * fonction serverless Netlify. Ici on ne fait qu'attendre l'initialisation
 * puis écouter sur un port.
 */
import app, { getClinic } from './app.js';
import { purgeExpiredSessions } from './auth.js';

const PORT = Number(process.env.PORT) || 4000;

// Nettoyage périodique des sessions expirées (inutile en serverless).
setInterval(() => {
  purgeExpiredSessions().catch(() => {});
}, 60 * 60 * 1000).unref();

getClinic()
  .then((clinic) => {
    app.listen(PORT, () => {
      console.log(`✓ API prête sur http://localhost:${PORT}`);
      console.log(`  Cabinet : ${clinic.name} (id ${clinic.id})`);
      if (process.env.NODE_ENV !== 'production') {
        console.log('  Frontend de développement : http://localhost:5173');
      }
    });
  })
  .catch((err) => {
    console.error('Impossible de démarrer :', err);
    process.exit(1);
  });
