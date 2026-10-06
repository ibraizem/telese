/**
 * Routes d'administration : utilisateurs & rôles, paramètres du cabinet,
 * types de rendez-vous et journal des actions.
 * Toutes ces routes exigent le rôle administrateur.
 */
import { createAsyncRouter } from '../async-router.js';
import db from '../db.js';
import { hashPassword, logAction, requireAuth, requirePermission } from '../auth.js';
import { badRequest, isEmail, notFound, validate } from '../errors.js';

const router = createAsyncRouter();
router.use(requireAuth);

/* ------------------------------------------------------------------ */
/* Utilisateurs                                                        */
/* ------------------------------------------------------------------ */

const USER_RULES = {
  name: { required: 'Le nom est obligatoire.', max: 80 },
  email: { required: 'L\'e-mail est obligatoire.', max: 120 },
  role: { required: 'Le rôle est obligatoire.' },
};

const ROLES = ['admin', 'secretary', 'practitioner'];
const ROLE_LABELS = { admin: 'Administrateur', secretary: 'Télésecrétaire', practitioner: 'Orthophoniste' };

const userShape = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  role_label: ROLE_LABELS[u.role] || u.role,
  practitioner_id: u.practitioner_id,
  practitioner_name: u.prac_first ? `${u.prac_first} ${u.prac_last}` : null,
  active: !!u.active,
  last_login_at: u.last_login_at,
  created_at: u.created_at,
});

const USER_SELECT = `
  SELECT u.*, p.first_name AS prac_first, p.last_name AS prac_last
    FROM users u LEFT JOIN practitioners p ON p.id = u.practitioner_id`;

router.get('/users', requirePermission('users.manage'), async (req, res) => {
  const rows = await db
    .prepare(`${USER_SELECT} WHERE u.clinic_id = ? ORDER BY u.active DESC, u.name`)
    .all(req.clinicId);
  res.json({ users: rows.map(userShape) });
});

router.post('/users', requirePermission('users.manage'), async (req, res) => {
  const body = req.body || {};
  const { ok, fields } = validate(body, USER_RULES);
  if (!ok) throw badRequest('Veuillez corriger les champs signalés.', fields);

  const email = String(body.email).trim().toLowerCase();
  if (!isEmail(email)) throw badRequest('Adresse e-mail invalide.', { email: 'Adresse e-mail invalide.' });
  if (!ROLES.includes(body.role)) throw badRequest('Rôle invalide.', { role: 'Rôle invalide.' });
  const password = String(body.password || '');
  if (password.length < 8) throw badRequest('Le mot de passe doit contenir au moins 8 caractères.', { password: '8 caractères minimum.' });

  const exists = await db.prepare('SELECT id FROM users WHERE clinic_id = ? AND lower(email) = ?').get(req.clinicId, email);
  if (exists) throw badRequest('Un utilisateur utilise déjà cet e-mail.', { email: 'E-mail déjà utilisé.' });

  const practitionerId = body.practitioner_id ? Number(body.practitioner_id) : null;
  if (body.role === 'practitioner' && !practitionerId) {
    throw badRequest('Sélectionnez l\'orthophoniste correspondant.', { practitioner_id: 'Obligatoire pour ce rôle.' });
  }

  const info = await db
    .prepare(
      `INSERT INTO users (clinic_id, name, email, password_hash, role, practitioner_id, active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    )
    .run(req.clinicId, String(body.name).trim(), email, hashPassword(password), body.role, practitionerId);

  await logAction({
    clinicId: req.clinicId,
    user: req.user,
    action: 'user.created',
    entityType: 'user',
    entityId: info.lastInsertRowid,
    summary: `Utilisateur créé : ${body.name} (${ROLE_LABELS[body.role]}) par ${req.user.name}`,
  });
  const row = await db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(info.lastInsertRowid);
  res.status(201).json({ user: userShape(row) });
});

router.patch('/users/:id(\\d+)', requirePermission('users.manage'), async (req, res) => {
  const current = await db.prepare(`${USER_SELECT} WHERE u.id = ? AND u.clinic_id = ?`).get(req.params.id, req.clinicId);
  if (!current) throw notFound('Utilisateur introuvable.');

  const body = req.body || {};
  const merged = { name: body.name ?? current.name, email: body.email ?? current.email, role: body.role ?? current.role };
  const { ok, fields } = validate(merged, USER_RULES);
  if (!ok) throw badRequest('Veuillez corriger les champs signalés.', fields);
  if (!ROLES.includes(merged.role)) throw badRequest('Rôle invalide.', { role: 'Rôle invalide.' });

  const email = String(merged.email).trim().toLowerCase();
  if (!isEmail(email)) throw badRequest('Adresse e-mail invalide.', { email: 'Adresse e-mail invalide.' });
  const dup = await db.prepare('SELECT id FROM users WHERE clinic_id = ? AND lower(email) = ? AND id != ?').get(req.clinicId, email, current.id);
  if (dup) throw badRequest('Un utilisateur utilise déjà cet e-mail.', { email: 'E-mail déjà utilisé.' });

  const password = String(body.password || '');
  if (password && password.length < 8) {
    throw badRequest('Le mot de passe doit contenir au moins 8 caractères.', { password: '8 caractères minimum.' });
  }
  const active = body.active === undefined ? current.active : body.active ? 1 : 0;
  if (!active && current.id === req.user.id) throw badRequest('Vous ne pouvez pas désactiver votre propre compte.');
  if (current.role === 'admin' && merged.role !== 'admin') {
    const admins = (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE clinic_id = ? AND role = 'admin' AND active = 1").get(req.clinicId)).n;
    if (admins <= 1) throw badRequest('Le cabinet doit garder au moins un administrateur.');
  }
  const practitionerId = merged.role === 'practitioner'
    ? Number(body.practitioner_id ?? current.practitioner_id ?? 0) || null
    : body.practitioner_id === null ? null : current.practitioner_id;
  if (merged.role === 'practitioner' && !practitionerId) {
    throw badRequest('Sélectionnez l\'orthophoniste correspondant.', { practitioner_id: 'Obligatoire pour ce rôle.' });
  }

  if (password) {
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), current.id);
  }
  await db.prepare(
    `UPDATE users SET name = ?, email = ?, role = ?, practitioner_id = ?, active = ? WHERE id = ? AND clinic_id = ?`
  ).run(String(merged.name).trim(), email, merged.role, practitionerId, active, current.id, req.clinicId);

  await logAction({
    clinicId: req.clinicId,
    user: req.user,
    action: 'user.updated',
    entityType: 'user',
    entityId: current.id,
    summary: `Utilisateur modifié : ${merged.name} (${ROLE_LABELS[merged.role]}) par ${req.user.name}`,
  });
  const row = await db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(current.id);
  res.json({ user: userShape(row) });
});

router.delete('/users/:id(\\d+)', requirePermission('users.manage'), async (req, res) => {
  const current = await db.prepare('SELECT * FROM users WHERE id = ? AND clinic_id = ?').get(req.params.id, req.clinicId);
  if (!current) throw notFound('Utilisateur introuvable.');
  if (current.id === req.user.id) throw badRequest('Vous ne pouvez pas supprimer votre propre compte.');
  if (current.role === 'admin') {
    const admins = (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE clinic_id = ? AND role = 'admin' AND active = 1").get(req.clinicId)).n;
    if (admins <= 1) throw badRequest('Le cabinet doit garder au moins un administrateur.');
  }
  await db.prepare('DELETE FROM users WHERE id = ? AND clinic_id = ?').run(current.id, req.clinicId);
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(current.id);
  await logAction({
    clinicId: req.clinicId,
    user: req.user,
    action: 'user.deleted',
    entityType: 'user',
    entityId: current.id,
    summary: `Utilisateur supprimé : ${current.name} par ${req.user.name}`,
  });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Paramètres du cabinet                                               */
/* ------------------------------------------------------------------ */

router.get('/settings', async (req, res) => {
  const clinic = await db.prepare('SELECT * FROM clinics WHERE id = ?').get(req.clinicId);
  res.json({ clinic });
});

router.put('/settings', requirePermission('clinic.manage'), async (req, res) => {
  const clinic = await db.prepare('SELECT * FROM clinics WHERE id = ?').get(req.clinicId);
  const body = req.body || {};
  const name = String(body.name ?? clinic.name).trim();
  if (!name) throw badRequest('Le nom du cabinet est obligatoire.', { name: 'Obligatoire.' });

  const dayStart = body.day_start ?? clinic.day_start;
  const dayEnd = body.day_end ?? clinic.day_end;
  if (dayEnd <= dayStart) throw badRequest('La fin de journée doit être après le début.', { day_end: 'Horaire invalide.' });
  const slot = Number(body.slot_minutes ?? clinic.slot_minutes);
  if (![15, 20, 30, 45, 60].includes(slot)) throw badRequest('Pas de créneau invalide.', { slot_minutes: 'Valeur attendue : 15, 20, 30, 45 ou 60.' });

  await db.prepare(
    `UPDATE clinics SET name = ?, phone = ?, address = ?, city = ?, day_start = ?, day_end = ?, slot_minutes = ?
      WHERE id = ?`
  ).run(
    name,
    String(body.phone ?? clinic.phone),
    String(body.address ?? clinic.address),
    String(body.city ?? clinic.city),
    dayStart,
    dayEnd,
    slot,
    req.clinicId
  );
  await logAction({
    clinicId: req.clinicId,
    user: req.user,
    action: 'clinic.updated',
    entityType: 'clinic',
    entityId: req.clinicId,
    summary: `Paramètres du cabinet modifiés par ${req.user.name}`,
  });
  res.json({ clinic: await db.prepare('SELECT * FROM clinics WHERE id = ?').get(req.clinicId) });
});

/* ------------------------------------------------------------------ */
/* Types de rendez-vous                                                */
/* ------------------------------------------------------------------ */

router.get('/appointment-types', async (req, res) => {
  res.json({
    types: await db
      .prepare('SELECT * FROM appointment_types WHERE clinic_id = ? ORDER BY sort_order, id')
      .all(req.clinicId),
  });
});

router.post('/appointment-types', requirePermission('clinic.manage'), async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) throw badRequest('Le nom du type est obligatoire.', { name: 'Obligatoire.' });
  const duration = Number(body.duration_min) || 30;
  if (duration < 5 || duration > 480) throw badRequest('Durée invalide.', { duration_min: 'Entre 5 et 480 minutes.' });
  const info = await db
    .prepare('INSERT INTO appointment_types (clinic_id, name, duration_min, color, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(req.clinicId, name, duration, body.color || '#4f6bed', Number(body.sort_order) || 0);
  await logAction({
    clinicId: req.clinicId, user: req.user, action: 'appointment_type.created',
    entityType: 'appointment_type', entityId: info.lastInsertRowid,
    summary: `Type de rendez-vous créé : ${name} par ${req.user.name}`,
  });
  res.status(201).json({ type: await db.prepare('SELECT * FROM appointment_types WHERE id = ?').get(info.lastInsertRowid) });
});

router.patch('/appointment-types/:id(\\d+)', requirePermission('clinic.manage'), async (req, res) => {
  const t = await db.prepare('SELECT * FROM appointment_types WHERE id = ? AND clinic_id = ?').get(req.params.id, req.clinicId);
  if (!t) throw notFound('Type introuvable.');
  const body = req.body || {};
  const name = String(body.name ?? t.name).trim();
  if (!name) throw badRequest('Le nom du type est obligatoire.', { name: 'Obligatoire.' });
  const duration = Number(body.duration_min ?? t.duration_min);
  if (duration < 5 || duration > 480) throw badRequest('Durée invalide.', { duration_min: 'Entre 5 et 480 minutes.' });
  await db.prepare('UPDATE appointment_types SET name = ?, duration_min = ?, color = ?, active = ? WHERE id = ?')
    .run(name, duration, body.color ?? t.color, body.active === undefined ? t.active : body.active ? 1 : 0, t.id);
  await logAction({
    clinicId: req.clinicId, user: req.user, action: 'appointment_type.updated',
    entityType: 'appointment_type', entityId: t.id,
    summary: `Type de rendez-vous modifié : ${name} par ${req.user.name}`,
  });
  res.json({ type: await db.prepare('SELECT * FROM appointment_types WHERE id = ?').get(t.id) });
});

router.delete('/appointment-types/:id(\\d+)', requirePermission('clinic.manage'), async (req, res) => {
  const t = await db.prepare('SELECT * FROM appointment_types WHERE id = ? AND clinic_id = ?').get(req.params.id, req.clinicId);
  if (!t) throw notFound('Type introuvable.');
  await db.prepare('DELETE FROM appointment_types WHERE id = ? AND clinic_id = ?').run(t.id, req.clinicId);
  await logAction({
    clinicId: req.clinicId, user: req.user, action: 'appointment_type.deleted',
    entityType: 'appointment_type', entityId: t.id,
    summary: `Type de rendez-vous supprimé : ${t.name} par ${req.user.name}`,
  });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Journal des actions                                                 */
/* ------------------------------------------------------------------ */

router.get('/activity', requirePermission('activity.view'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const params = [req.clinicId];
  let sql = 'SELECT * FROM activity_logs WHERE clinic_id = ?';
  if (req.query.action) { sql += ' AND action LIKE ?'; params.push(`${req.query.action}%`); }
  if (req.query.entity_type) { sql += ' AND entity_type = ?'; params.push(req.query.entity_type); }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(limit);
  res.json({ logs: await db.prepare(sql).all(...params) });
});

export default router;
