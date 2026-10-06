/**
 * Authentification, sessions, rôles/permissions et journal d'actions.
 *
 * Sécurité retenue pour la V1 :
 * - Mots de passe hachés avec bcrypt (cost 10).
 * - Jeton de session aléatoire (256 bits) stocké en base, transmis dans un
 *   cookie HttpOnly + SameSite=Lax (non lisible par le JavaScript => pas de
 *   vol de session via XSS).
 * - Expiration de session (12 h) et nettoyage des sessions expirées.
 * - Toutes les routes métier exigent une session valide ; le contrôle de rôle
 *   est fait côté serveur (le frontend ne fait qu'afficher/masquer).
 * - Chiffrement en transit : l'application se déploie derrière HTTPS (voir
 *   README) ; en local, tout reste sur localhost.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import db from './db.js';
import { forbidden, unauthorized } from './errors.js';

export const SESSION_HOURS = 12;
export const COOKIE_NAME = 'cabinet_session';

export const hashPassword = (plain) => bcrypt.hashSync(String(plain), 10);
export const verifyPassword = (plain, hash) => bcrypt.compareSync(String(plain), String(hash));
export const randomToken = () => crypto.randomBytes(32).toString('hex');

/* ------------------------------------------------------------------ */
/* Permissions                                                         */
/* ------------------------------------------------------------------ */

/**
 * `admin` = accès total, `secretary` = usage quotidien du cabinet,
 * `practitioner` = son agenda + consultation administrative des patients.
 */
export const PERMISSIONS = {
  admin: ['*'],
  secretary: [
    'dashboard.view',
    'agenda.view', 'agenda.write',
    'patients.view', 'patients.write',
    'waiting.view', 'waiting.write',
    'practitioners.view',
    'messages.send',
    'activity.view',
  ],
  practitioner: [
    'dashboard.view',
    'agenda.view', 'agenda.write:self',
    'patients.view',
    'availability.write:self',
    'activity.view',
  ],
};

export function has(user, permission) {
  if (!user) return false;
  const list = PERMISSIONS[user.role] || [];
  if (list.includes('*')) return true;
  if (list.includes(permission)) return true;
  // « agenda.write:self » donne aussi 'agenda.write' sur ses propres données
  if (permission.endsWith('.write') && list.includes(`${permission}:self`)) return true;
  return false;
}

export const requirePermission = (permission) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!has(req.user, permission)) return next(forbidden(`Votre rôle ne permet cette action (${permission}).`));
  next();
};

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden('Votre rôle ne permet cette action.'));
  next();
};

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export async function createSession(user, meta = {}) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
  await db.prepare(
    `INSERT INTO sessions (id, user_id, clinic_id, expires_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(token, user.id, user.clinic_id, expires.toISOString(), meta.userAgent || '', meta.ip || '');
  return { token, expires };
}

export async function destroySession(token) {
  if (token) await db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
}

export async function purgeExpiredSessions() {
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

/** Attache `req.user` + `req.clinicId` si la session est valide. */
export async function attachUser(req, _res, next) {
  const token = parseCookies(req)[COOKIE_NAME];
  req.sessionToken = token || null;
  req.user = null;
  req.clinicId = null;
  if (token) {
    const row = await db
      .prepare(
        `SELECT s.id AS token, s.expires_at, u.*, p.first_name AS prac_first, p.last_name AS prac_last
           FROM sessions s
           JOIN users u ON u.id = s.user_id
           LEFT JOIN practitioners p ON p.id = u.practitioner_id
          WHERE s.id = ?`
      )
      .get(token);
    if (row && row.active && new Date(row.expires_at) > new Date()) {
      const { prac_first, prac_last, ...user } = row;
      user.practitioner_name = prac_first ? `${prac_first} ${prac_last}` : null;
      req.user = user;
      req.clinicId = user.clinic_id;
    }
  }
  next();
}

export const requireAuth = (req, _res, next) => (req.user ? next() : next(unauthorized()));

export function setSessionCookie(res, token, expiresAt) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
      (new Date(expiresAt).getTime() - Date.now()) / 1000
    )};${secure}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/* ------------------------------------------------------------------ */
/* Journal d'actions                                                   */
/* ------------------------------------------------------------------ */

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** "03/10/2026 à 14:32" (format attendu par le client). */
export function frDateTime(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getDate())}/${p(date.getMonth() + 1)}/${date.getFullYear()} à ${p(date.getHours())}:${p(date.getMinutes())}`;
}

export const frDate = (date = new Date()) => frDateTime(date).split(' à ')[0];
export const monthName = (index) => MONTHS[index];

/**
 * Écrit une ligne au journal d'actions.
 * `summary` est la phrase affichée : "Rendez-vous créé par Sophie — 03/10/2026 à 14:32".
 */
export async function logAction({ clinicId, user, action, entityType = '', entityId = null, summary = '' }) {
  const userName = user ? user.name : 'Système';
  const text = summary || `${action} par ${userName}`;
  await db.prepare(
    `INSERT INTO activity_logs (clinic_id, user_id, user_name, action, entity_type, entity_id, summary)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(clinicId, user ? user.id : null, userName, action, entityType, entityId, `${text} — ${frDateTime()}`);
}
