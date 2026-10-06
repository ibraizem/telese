/**
 * Couche base de données (libSQL / Turso).
 *
 * Historique : la V1 utilisait better-sqlite3 (fichier local, API synchrone).
 * Comme l'application est désormais déployée sur Netlify (fonctions
 * serverless, sans disque persistant), la base est hébergée sur Turso
 * (libSQL, compatible SQLite) et atteinte en HTTP.
 *
 * Pour garder le reste du code lisible et peu modifié, ce module expose un
 * « shim » qui imite l'API de better-sqlite3 (`db.prepare(sql).get/all/run`)
 * mais qui renvoie des promesses. Les appelants doivent donc `await`.
 *
 * - En développement et dans les tests : `file:data/app.db` (fichier local).
 * - En production : `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`.
 *
 * Choix d'architecture inchangés :
 * - Toutes les tables métier portent `clinic_id` (multi-tenant V2).
 * - Les dates/heures sont stockées en texte local naïf.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'app.db');

/**
 * URL de la base :
 * - `TURSO_DATABASE_URL` (libsql://… ou https://…) en production ;
 * - sinon un fichier SQLite local (`file:/chemin/vers/app.db`).
 */
const url = process.env.TURSO_DATABASE_URL || `file:${DB_PATH}`;
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;
export const isRemote = Boolean(process.env.TURSO_DATABASE_URL);

if (!isRemote && !fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// En production on n'embarque que le client HTTP (pas de module natif) ;
// en local, le client Node gère les URL « file: ».
const { createClient } = isRemote
  ? await import('@libsql/client/web')
  : await import('@libsql/client');

export const client = createClient({ url, authToken });

// Réglages locaux ; sur Turso le journal et les clés étrangères sont gérés.
if (!isRemote) {
  await client.execute('PRAGMA journal_mode = WAL').catch(() => {});
}
await client.execute('PRAGMA foreign_keys = ON').catch(() => {});

/** Normalise une valeur de paramètre (libSQL refuse `undefined`/booléens). */
const norm = (v) => {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
};

/** Renvoie une copie « objet simple » d'une ligne (au lieu des Row libSQL). */
const plain = (row) => (row ? { ...row } : row);

/**
 * Shim compatible better-sqlite3, mais asynchrone.
 * Usage : `const row = await db.prepare('SELECT … WHERE id = ?').get(id);`
 */
export const db = {
  prepare(sql) {
    return {
      get: async (...args) =>
        plain((await client.execute({ sql, args: args.map(norm) })).rows[0]),
      all: async (...args) =>
        (await client.execute({ sql, args: args.map(norm) })).rows.map(plain),
      run: async (...args) => {
        const res = await client.execute({ sql, args: args.map(norm) });
        return {
          lastInsertRowid: res.lastInsertRowid != null ? Number(res.lastInsertRowid) : null,
          changes: Number(res.rowsAffected),
        };
      },
    };
  },
  /** Exécute un script SQL contenant plusieurs instructions. */
  async exec(sql) {
    await client.executeMultiple(sql);
  },
  /** Exécute plusieurs instructions en une seule transaction. */
  async batch(statements) {
    return client.batch(statements, 'write');
  },
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clinics (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  phone          TEXT    DEFAULT '',
  address        TEXT    DEFAULT '',
  city           TEXT    DEFAULT '',
  timezone       TEXT    DEFAULT 'Africa/Casablanca',
  day_start      TEXT    DEFAULT '09:00',
  day_end        TEXT    DEFAULT '18:00',
  slot_minutes   INTEGER DEFAULT 30,
  created_at     TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS practitioners (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id      INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  first_name     TEXT    NOT NULL,
  last_name      TEXT    NOT NULL,
  email          TEXT    DEFAULT '',
  phone          TEXT    DEFAULT '',
  color          TEXT    DEFAULT '#4f6bed',
  active         INTEGER DEFAULT 1,
  can_edit_own_availability INTEGER DEFAULT 0,
  created_at     TEXT    DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_practitioners_clinic ON practitioners(clinic_id);

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id      INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name           TEXT    NOT NULL,
  email          TEXT    NOT NULL,
  password_hash  TEXT    NOT NULL,
  role           TEXT    NOT NULL CHECK (role IN ('admin','secretary','practitioner')),
  practitioner_id INTEGER REFERENCES practitioners(id) ON DELETE SET NULL,
  active         INTEGER DEFAULT 1,
  last_login_at  TEXT,
  created_at     TEXT    DEFAULT (datetime('now')),
  UNIQUE (clinic_id, email)
);

CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT    PRIMARY KEY,          -- jeton de session (cookie httpOnly)
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clinic_id      INTEGER NOT NULL,
  created_at     TEXT    DEFAULT (datetime('now')),
  expires_at     TEXT    NOT NULL,
  user_agent     TEXT    DEFAULT '',
  ip             TEXT    DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS patients (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id      INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  first_name     TEXT    NOT NULL,
  last_name      TEXT    NOT NULL,
  phone          TEXT    DEFAULT '',
  whatsapp       TEXT    DEFAULT '',
  email          TEXT    DEFAULT '',
  birth_date     TEXT    DEFAULT '',            -- facultatif
  guardian_name  TEXT    DEFAULT '',            -- responsable légal, facultatif
  guardian_phone TEXT    DEFAULT '',
  admin_comment  TEXT    DEFAULT '',            -- commentaire purement administratif
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT    DEFAULT (datetime('now')),
  updated_at     TEXT    DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_patients_clinic ON patients(clinic_id);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(clinic_id, last_name, first_name);

CREATE TABLE IF NOT EXISTS appointment_types (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id      INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name           TEXT    NOT NULL,
  duration_min   INTEGER NOT NULL DEFAULT 30,
  color          TEXT    DEFAULT '#4f6bed',
  active         INTEGER DEFAULT 1,
  sort_order     INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS appointments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id      INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id     INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  practitioner_id INTEGER REFERENCES practitioners(id) ON DELETE SET NULL,
  type_id        INTEGER REFERENCES appointment_types(id) ON DELETE SET NULL,
  start_at       TEXT    NOT NULL,              -- "YYYY-MM-DDTHH:MM"
  duration_min   INTEGER NOT NULL DEFAULT 30,
  status         TEXT    NOT NULL DEFAULT 'confirmed'
                 CHECK (status IN ('request','confirmed','to_confirm','cancelled','postponed','done','absent')),
  initial_status TEXT    NOT NULL DEFAULT 'confirmed',   -- statut à la création (mesure du taux de transformation)
  comment        TEXT    DEFAULT '',
  created_by     INTEGER REFERENCES users(id),
  updated_by     INTEGER REFERENCES users(id),
  created_at     TEXT    DEFAULT (datetime('now')),
  updated_at     TEXT    DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_appts_clinic_date ON appointments(clinic_id, start_at);
CREATE INDEX IF NOT EXISTS idx_appts_practitioner ON appointments(practitioner_id, start_at);
CREATE INDEX IF NOT EXISTS idx_appts_patient ON appointments(patient_id);

-- Disponibilités hebdomadaires récurrentes par orthophoniste
CREATE TABLE IF NOT EXISTS availability (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id      INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  practitioner_id INTEGER NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  weekday        INTEGER NOT NULL,              -- 1 = lundi ... 7 = dimanche (ISO)
  start_time     TEXT    NOT NULL,              -- "09:00"
  end_time       TEXT    NOT NULL,              -- "18:00"
  kind           TEXT    NOT NULL DEFAULT 'work' CHECK (kind IN ('work','break')),
  label          TEXT    DEFAULT '',
  UNIQUE (practitioner_id, weekday, start_time, end_time, kind)
);

-- Congés, pauses, indisponibilités et jours exceptionnels (ponctuels)
CREATE TABLE IF NOT EXISTS blocked_times (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id      INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  practitioner_id INTEGER REFERENCES practitioners(id) ON DELETE CASCADE, -- NULL = cabinet entier
  date           TEXT    NOT NULL,              -- "YYYY-MM-DD"
  start_time     TEXT    NOT NULL,              -- "09:00"
  end_time       TEXT    NOT NULL,              -- "18:00"
  reason         TEXT    NOT NULL DEFAULT 'conge' CHECK (reason IN ('pause','conge','exception','indispo')),
  note           TEXT    DEFAULT '',
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT    DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_blocked_date ON blocked_times(clinic_id, date);

CREATE TABLE IF NOT EXISTS waiting_list (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id      INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id     INTEGER REFERENCES patients(id) ON DELETE SET NULL,
  full_name      TEXT    NOT NULL,
  phone          TEXT    DEFAULT '',
  appointment_type TEXT  DEFAULT '',
  desired_date   TEXT    DEFAULT '',            -- créneau souhaité (facultatif)
  day_preference TEXT    DEFAULT '',            -- ex. "mardi ou jeudi après-midi"
  comment        TEXT    DEFAULT '',
  status         TEXT    NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','contacted','scheduled','removed')),
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT    DEFAULT (datetime('now'))
);

-- Journal des messages générés (copie / WhatsApp / email).
-- La V1 ne fait que générer le texte ; l'envoi réel sera branché en V2.
CREATE TABLE IF NOT EXISTS messages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id      INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id     INTEGER REFERENCES patients(id) ON DELETE SET NULL,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  template_key   TEXT    NOT NULL,
  channel        TEXT    NOT NULL DEFAULT 'copy' CHECK (channel IN ('copy','whatsapp','email')),
  body           TEXT    NOT NULL,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS message_templates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id      INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  template_key   TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  body           TEXT    NOT NULL,
  UNIQUE (clinic_id, template_key)
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id      INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name      TEXT    DEFAULT '',
  action         TEXT    NOT NULL,              -- appointment.created, patient.updated...
  entity_type    TEXT    DEFAULT '',
  entity_id      INTEGER,
  summary        TEXT    DEFAULT '',            -- "Rendez-vous créé par Sophie — 03/10/2026 à 14:32"
  created_at     TEXT    DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_logs_clinic ON activity_logs(clinic_id, created_at DESC);
`;

await db.exec(SCHEMA);

/** Migration légère : ajoute une colonne si elle n'existe pas encore. */
export async function ensureColumn(table, column, definition) {
  const cols = await db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Colonnes ajoutées après la première version du schéma.
await ensureColumn('appointments', 'initial_status', "TEXT NOT NULL DEFAULT 'confirmed'");

/** Compteurs utilisés pour l'audit (dev/seed). */
export const counts = async () => {
  const tables = [
    'clinics', 'practitioners', 'users', 'patients', 'appointment_types',
    'appointments', 'availability', 'blocked_times', 'waiting_list',
    'messages', 'message_templates', 'activity_logs',
  ];
  const out = {};
  for (const t of tables) out[t] = (await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).n;
  return out;
};

export default db;
