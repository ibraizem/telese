/**
 * Routes orthophonistes : fiches, disponibilités hebdomadaires.
 * La gestion des fiches est réservée à l'administrateur ; un orthophoniste
 * peut modifier ses propres disponibilités si le cabinet l'y autorise.
 */
import { createAsyncRouter } from '../async-router.js';
import db from '../db.js';
import { logAction, requireAuth, requirePermission } from '../auth.js';
import { badRequest, forbidden, isTime, notFound, validate } from '../errors.js';
import { getWeeklyAvailability, hasCustomAvailability } from '../scheduling.js';

const router = createAsyncRouter();
router.use(requireAuth);

const RULES = {
  first_name: { required: 'Le prénom est obligatoire.', max: 60 },
  last_name: { required: 'Le nom est obligatoire.', max: 60 },
  email: { max: 120 },
  phone: { max: 40 },
};

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

const shape = (p) => ({
  id: p.id,
  first_name: p.first_name,
  last_name: p.last_name,
  full_name: `${p.first_name} ${p.last_name}`,
  email: p.email,
  phone: p.phone,
  color: p.color,
  active: !!p.active,
  can_edit_own_availability: !!p.can_edit_own_availability,
  has_custom_availability: p.has_custom_availability ?? undefined,
  availability: p.availability ?? undefined,
});

router.get('/', async (req, res) => {
  const raw = await db
    .prepare('SELECT * FROM practitioners WHERE clinic_id = ? ORDER BY active DESC, last_name')
    .all(req.clinicId);
  const rows = await Promise.all(
    raw.map(async (p) => ({
      ...p,
      has_custom_availability: await hasCustomAvailability(p.id),
      availability: await getWeeklyAvailability(p.id),
    }))
  );

  const counts = await db
    .prepare(
      `SELECT practitioner_id, COUNT(*) AS n FROM appointments
        WHERE clinic_id = ? AND date(start_at) >= date('now','localtime') AND status NOT IN ('cancelled')
        GROUP BY practitioner_id`
    )
    .all(req.clinicId);
  const map = Object.fromEntries(counts.map((c) => [c.practitioner_id, c.n]));

  res.json({ practitioners: rows.map((p) => ({ ...shape(p), upcoming_count: map[p.id] || 0 })) });
});

router.get('/:id(\\d+)', async (req, res) => {
  const p = await db.prepare('SELECT * FROM practitioners WHERE id = ? AND clinic_id = ?').get(req.params.id, req.clinicId);
  if (!p) throw notFound('Orthophoniste introuvable.');
  res.json({
    practitioner: shape({
      ...p,
      has_custom_availability: await hasCustomAvailability(p.id),
      availability: await getWeeklyAvailability(p.id),
    }),
  });
});

router.post('/', requirePermission('practitioners.manage'), async (req, res) => {
  const body = req.body || {};
  const { ok, fields } = validate(body, RULES);
  if (!ok) throw badRequest('Veuillez corriger les champs signalés.', fields);

  const info = await db
    .prepare(
      `INSERT INTO practitioners (clinic_id, first_name, last_name, email, phone, color, active, can_edit_own_availability)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
    )
    .run(
      req.clinicId,
      body.first_name.trim(),
      body.last_name.trim(),
      String(body.email || '').trim(),
      String(body.phone || '').trim(),
      body.color || '#4f6bed',
      body.can_edit_own_availability ? 1 : 0
    );

  await logAction({
    clinicId: req.clinicId,
    user: req.user,
    action: 'practitioner.created',
    entityType: 'practitioner',
    entityId: info.lastInsertRowid,
    summary: `Orthophoniste créé : ${body.first_name} ${body.last_name} par ${req.user.name}`,
  });
  const p = await db.prepare('SELECT * FROM practitioners WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ practitioner: shape({ ...p, availability: {}, has_custom_availability: false }) });
});

router.patch('/:id(\\d+)', requirePermission('practitioners.manage'), async (req, res) => {
  const p = await db.prepare('SELECT * FROM practitioners WHERE id = ? AND clinic_id = ?').get(req.params.id, req.clinicId);
  if (!p) throw notFound('Orthophoniste introuvable.');
  const body = { ...p, ...(req.body || {}) };
  const { ok, fields } = validate(body, RULES);
  if (!ok) throw badRequest('Veuillez corriger les champs signalés.', fields);

  await db.prepare(
    `UPDATE practitioners SET first_name = ?, last_name = ?, email = ?, phone = ?, color = ?,
        active = ?, can_edit_own_availability = ? WHERE id = ? AND clinic_id = ?`
  ).run(
    String(body.first_name).trim(),
    String(body.last_name).trim(),
    String(body.email || '').trim(),
    String(body.phone || '').trim(),
    body.color || p.color,
    body.active === false || body.active === 0 ? 0 : 1,
    body.can_edit_own_availability ? 1 : 0,
    p.id,
    req.clinicId
  );

  await logAction({
    clinicId: req.clinicId,
    user: req.user,
    action: 'practitioner.updated',
    entityType: 'practitioner',
    entityId: p.id,
    summary: `Fiche orthophoniste modifiée : ${body.first_name} ${body.last_name} par ${req.user.name}`,
  });
  const updated = await db.prepare('SELECT * FROM practitioners WHERE id = ?').get(p.id);
  res.json({
    practitioner: shape({ ...updated, availability: await getWeeklyAvailability(p.id), has_custom_availability: await hasCustomAvailability(p.id) }),
  });
});

router.delete('/:id(\\d+)', requirePermission('practitioners.manage'), async (req, res) => {
  const p = await db.prepare('SELECT * FROM practitioners WHERE id = ? AND clinic_id = ?').get(req.params.id, req.clinicId);
  if (!p) throw notFound('Orthophoniste introuvable.');
  const used = (await db.prepare('SELECT COUNT(*) AS n FROM appointments WHERE practitioner_id = ?').get(p.id)).n;
  if (used > 0) {
    // On désactive plutôt que de supprimer pour ne pas perdre l'historique.
    await db.prepare('UPDATE practitioners SET active = 0 WHERE id = ?').run(p.id);
    await logAction({
      clinicId: req.clinicId,
      user: req.user,
      action: 'practitioner.deactivated',
      entityType: 'practitioner',
      entityId: p.id,
      summary: `Orthophoniste désactivé : ${p.first_name} ${p.last_name} par ${req.user.name}`,
    });
    return res.json({ ok: true, deactivated: true });
  }
  await db.prepare('DELETE FROM practitioners WHERE id = ? AND clinic_id = ?').run(p.id, req.clinicId);
  await logAction({
    clinicId: req.clinicId,
    user: req.user,
    action: 'practitioner.deleted',
    entityType: 'practitioner',
    entityId: p.id,
    summary: `Orthophoniste supprimé : ${p.first_name} ${p.last_name} par ${req.user.name}`,
  });
  res.json({ ok: true });
});

/* ---------------------------------------------------------------- */
/* Disponibilités hebdomadaires                                      */
/* ---------------------------------------------------------------- */

async function canEditAvailability(req, practitionerId) {
  if (req.user.role === 'admin') return true;
  if (req.user.role !== 'practitioner' || req.user.practitioner_id !== practitionerId) return false;
  const row = await db
    .prepare('SELECT can_edit_own_availability FROM practitioners WHERE id = ?')
    .get(practitionerId);
  return !!row?.can_edit_own_availability;
}

router.get('/:id(\\d+)/availability', async (req, res) => {
  const p = await db.prepare('SELECT * FROM practitioners WHERE id = ? AND clinic_id = ?').get(req.params.id, req.clinicId);
  if (!p) throw notFound('Orthophoniste introuvable.');
  res.json({
    practitioner_id: p.id,
    has_custom_availability: await hasCustomAvailability(p.id),
    slots: await db.prepare('SELECT * FROM availability WHERE practitioner_id = ? ORDER BY weekday, start_time').all(p.id),
  });
});

/** Remplace entièrement la semaine d'un orthophoniste. */
router.put('/:id(\\d+)/availability', async (req, res) => {
  const p = await db.prepare('SELECT * FROM practitioners WHERE id = ? AND clinic_id = ?').get(req.params.id, req.clinicId);
  if (!p) throw notFound('Orthophoniste introuvable.');
  if (!(await canEditAvailability(req, p.id))) throw forbidden('Vous ne pouvez pas modifier ces disponibilités.');

  const slots = Array.isArray(req.body?.slots) ? req.body.slots : null;
  if (!slots) throw badRequest('Paramètre slots manquant.');

  const prepared = [];
  for (const s of slots) {
    const weekday = Number(s.weekday);
    if (!WEEKDAYS.includes(weekday)) throw badRequest('Jour invalide.', { slots: 'Jour invalide.' });
    if (!isTime(s.start_time) || !isTime(s.end_time)) throw badRequest('Horaire invalide.', { slots: 'Horaire invalide.' });
    if (s.end_time <= s.start_time) throw badRequest('La fin doit être après le début.', { slots: 'Horaire invalide.' });
    prepared.push({
      weekday,
      start_time: s.start_time,
      end_time: s.end_time,
      kind: s.kind === 'break' ? 'break' : 'work',
      label: String(s.label || '').slice(0, 60),
    });
  }

  // Remplacement atomique de la semaine (transaction côté Turso/libSQL).
  await db.batch([
    { sql: 'DELETE FROM availability WHERE practitioner_id = ?', args: [p.id] },
    ...prepared.map((s) => ({
      sql: `INSERT OR IGNORE INTO availability (clinic_id, practitioner_id, weekday, start_time, end_time, kind, label)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [req.clinicId, p.id, s.weekday, s.start_time, s.end_time, s.kind, s.label],
    })),
  ]);

  await logAction({
    clinicId: req.clinicId,
    user: req.user,
    action: 'availability.updated',
    entityType: 'practitioner',
    entityId: p.id,
    summary: `Disponibilités mises à jour : ${p.first_name} ${p.last_name} par ${req.user.name}`,
  });

  res.json({
    practitioner_id: p.id,
    has_custom_availability: await hasCustomAvailability(p.id),
    slots: await db.prepare('SELECT * FROM availability WHERE practitioner_id = ? ORDER BY weekday, start_time').all(p.id),
  });
});

export default router;
