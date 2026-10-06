/**
 * Routes d'authentification : connexion, déconnexion, profil courant.
 */
import { createAsyncRouter } from '../async-router.js';
import db from '../db.js';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  PERMISSIONS,
  requireAuth,
  setSessionCookie,
  verifyPassword,
} from '../auth.js';
import { badRequest, unauthorized } from '../errors.js';

const router = createAsyncRouter();

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  practitioner_id: u.practitioner_id,
  practitioner_name: u.practitioner_name || null,
  permissions: PERMISSIONS[u.role] || [],
});

router.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) throw badRequest('E-mail et mot de passe obligatoires.');

  const user = await db.prepare('SELECT * FROM users WHERE lower(email) = ? AND active = 1').get(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw unauthorized('E-mail ou mot de passe incorrect.');
  }

  const { token, expires } = await createSession(user, { ip: req.ip, userAgent: req.headers['user-agent'] });
  await db.prepare('UPDATE users SET last_login_at = datetime(\'now\') WHERE id = ?').run(user.id);

  const clinic = await db.prepare('SELECT * FROM clinics WHERE id = ?').get(user.clinic_id);
  const prac = user.practitioner_id
    ? await db.prepare('SELECT first_name, last_name FROM practitioners WHERE id = ?').get(user.practitioner_id)
    : null;

  setSessionCookie(res, token, expires);
  res.json({
    user: publicUser({ ...user, practitioner_name: prac ? `${prac.first_name} ${prac.last_name}` : null }),
    clinic,
  });
});

router.post('/logout', async (req, res) => {
  await destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const clinic = await db.prepare('SELECT * FROM clinics WHERE id = ?').get(req.clinicId);
  res.json({ user: publicUser(req.user), clinic });
});

export default router;
