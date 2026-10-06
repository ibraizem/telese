/**
 * Application Express (API REST + servage du frontend compilé).
 *
 * Ce module est partagé par :
 * - `server/index.js` (serveur longue durée, npm run dev / start) ;
 * - `netlify/functions/api.js` (fonction serverless sur Netlify).
 *
 * Contrainte de déploiement : ni `await` de haut niveau, ni `import.meta`,
 * car Netlify charge la fonction depuis un lanceur CommonJS. L'initialisation
 * (base de données + cabinet par défaut) est donc faite paresseusement par
 * le middleware `prepare()` qui précède toutes les routes.
 *
 * Sécurité V1 : sessions httpOnly, en-têtes durcis, limitation du taux de
 * connexion, journalisation, validation systématique des entrées.
 * Déployer derrière HTTPS pour chiffrer les données en transit.
 */
import path from 'node:path';
import express from 'express';
import db, { isRemote } from './db.js';
import { attachUser, purgeExpiredSessions } from './auth.js';
import { ApiError } from './errors.js';
import { ensureDefaultTemplates } from './routes/messages.js';

import authRoutes from './routes/auth.js';
import patientRoutes from './routes/patients.js';
import appointmentRoutes from './routes/appointments.js';
import practitionerRoutes from './routes/practitioners.js';
import availabilityRoutes from './routes/availability.js';
import waitingRoutes from './routes/waiting.js';
import statsRoutes from './routes/stats.js';
import adminRoutes from './routes/admin.js';
import messageRoutes from './routes/messages.js';

/* ------------------------------------------------------------------ */
/* Cabinet par défaut (créé au premier démarrage, remplacé par le seed) */
/* ------------------------------------------------------------------ */
async function ensureClinic() {
  let clinic = await db.prepare('SELECT * FROM clinics ORDER BY id LIMIT 1').get();
  if (!clinic) {
    const info = await db
      .prepare(
        `INSERT INTO clinics (name, phone, address, city, day_start, day_end, slot_minutes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('Cabinet d\'orthophonie', '+212 5 00 00 00 00', '', 'Casablanca', '09:00', '18:00', 30);
    clinic = await db.prepare('SELECT * FROM clinics WHERE id = ?').get(info.lastInsertRowid);
  }
  await ensureDefaultTemplates(clinic.id);
  return clinic;
}

let prepared = null;
let clinicRow = null;

/**
 * Prépare l'application : connexion + schéma de la base, cabinet par défaut,
 * nettoyage des sessions expirées. Idempotent (une seule exécution par process).
 */
function prepare() {
  if (!prepared) {
    prepared = (async () => {
      clinicRow = await ensureClinic();
      await purgeExpiredSessions();
      return clinicRow;
    })().catch((err) => {
      prepared = null;
      clinicRow = null;
      throw err;
    });
  }
  return prepared;
}

/** Cabinet courant (promesse résolue après initialisation). */
export const getClinic = () => prepare();

/* ------------------------------------------------------------------ */
/* Application                                                         */
/* ------------------------------------------------------------------ */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

/**
 * Health check : placé AVANT le middleware d'initialisation afin de rester
 * répondable même quand la base échoue. Il expose l'état de la dépendance
 * (et jamais de secret) pour diagnostiquer un déploiement.
 */
app.get('/api/health', async (_req, res) => {
  let dbStatus = 'ok';
  let error = null;
  try {
    await prepare();
  } catch (err) {
    dbStatus = 'error';
    error = String(err?.message || err).slice(0, 300);
  }
  res.json({
    ok: true,
    app: 'devlink-secretariat',
    version: '1.0.0',
    time: new Date().toISOString(),
    // La base est-elle distante (Turso) ou bien un fichier local ?
    remote: isRemote,
    db: dbStatus,
    ...(error ? { error } : {}),
  });
});

// Initialisation paresseuse : chaque requête attend que la base soit prête.
app.use((_req, _res, next) => {
  prepare().then(() => next()).catch(next);
});

// Sur Netlify, une réécriture peut transmettre le chemin préfixé par la
// fonction (/.netlify/functions/api/…). On le retire pour qu'Express voie /api/…
// Deux formes sont observables selon les versions de Netlify :
//   /api/health                      → inchangé
//   /.netlify/functions/api/health   → /api/health
//   /.netlify/functions/api/api/health → /api/health
app.use((req, _res, next) => {
  const prefix = '/.netlify/functions/api';
  if (req.url.startsWith(prefix)) {
    const stripped = req.url.slice(prefix.length) || '/';
    req.url = stripped.startsWith('/api') ? stripped : `/api${stripped}`;
  }
  next();
});

app.use(express.json({ limit: '1mb' }));

// En-têtes de sécurité (durcissement basique, sans dépendance externe).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Limitation simple du taux de connexion (anti force brute sur /login).
const attempts = new Map();
app.use('/api/auth/login', (req, res, next) => {
  if (req.method !== 'POST') return next();
  const key = req.ip;
  const now = Date.now();
  const bucket = (attempts.get(key) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (bucket.length >= 20) {
    return res.status(429).json({
      error: { code: 'rate_limited', message: 'Trop de tentatives. Réessayez dans quelques minutes.' },
    });
  }
  bucket.push(now);
  attempts.set(key, bucket);
  next();
});

// attachUser est asynchrone : on propage explicitement ses erreurs.
app.use((req, res, next) => attachUser(req, res, next).catch(next));

app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/practitioners', practitionerRoutes);
app.use('/api/blocked-times', availabilityRoutes);
app.use('/api/waiting-list', waitingRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/messages', messageRoutes);

// Toute route /api inconnue renvoie un 404 JSON propre.
app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Route API inconnue.' } }));

/* ------------------------------------------------------------------ */
/* Frontend compilé (production locale)                                */
/* Sur Netlify, les fichiers statiques sont servis par le CDN et cette  */
/* partie n'est jamais atteinte.                                       */
/* ------------------------------------------------------------------ */
const distDir = path.resolve(process.cwd(), 'dist');
app.use(express.static(distDir));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err) res.status(404).send('Frontend non compilé. Lancez « npm run build » ou « npm run dev ».');
  });
});

/* ------------------------------------------------------------------ */
/* Gestion des erreurs                                                 */
/* ------------------------------------------------------------------ */
app.use((err, _req, res, _next) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, fields: err.fields } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'bad_request', message: 'Corps JSON invalide.' } });
  }
  console.error('[erreur]', err);
  res.status(500).json({ error: { code: 'internal_error', message: 'Erreur interne du serveur.' } });
});

export { app };
export { requireAuth } from './auth.js';
export default app;
