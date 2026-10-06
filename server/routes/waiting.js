/**
 * Routes liste d'attente : ajout de patients en attente d'un créneau,
 * suivi (à contacter / contacté / placé) et retrait.
 */
import { createAsyncRouter } from '../async-router.js';
import db from '../db.js';
import { logAction, requireAuth, requirePermission } from '../auth.js';
import { badRequest, notFound, validate } from '../errors.js';

const router = createAsyncRouter();
router.use(requireAuth);

const RULES = {
  full_name: { required: 'Le nom du patient est obligatoire.', max: 120 },
  phone: { max: 40 },
  appointment_type: { max: 80 },
  day_preference: { max: 120 },
  comment: { max: 500 },
};

const STATUSES = ['pending', 'contacted', 'scheduled', 'removed'];
const STATUS_LABELS = {
  pending: 'En attente',
  contacted: 'Patient contacté',
  scheduled: 'Placé',
  removed: 'Retiré',
};

const SELECT = `
  SELECT w.*, p.first_name AS pat_first, p.last_name AS pat_last, p.phone AS pat_phone,
         a.start_at AS scheduled_start, a.duration_min AS scheduled_duration, a.status AS scheduled_status
    FROM waiting_list w
    LEFT JOIN patients p ON p.id = w.patient_id
    LEFT JOIN appointments a ON a.id = w.appointment_id`;

const shape = (w) => ({
  id: w.id,
  patient_id: w.patient_id,
  full_name: w.full_name || (w.pat_first ? `${w.pat_first} ${w.pat_last}` : ''),
  phone: w.phone || w.pat_phone || '',
  appointment_type: w.appointment_type,
  desired_date: w.desired_date,
  day_preference: w.day_preference,
  comment: w.comment,
  status: w.status,
  status_label: STATUS_LABELS[w.status] || w.status,
  appointment_id: w.appointment_id,
  scheduled_start: w.scheduled_start || null,
  created_at: w.created_at,
});

router.get('/', async (req, res) => {
  const status = req.query.status && req.query.status !== 'all' ? String(req.query.status) : null;
  const params = [req.clinicId];
  let sql = `${SELECT} WHERE w.clinic_id = ?`;
  if (status) { sql += ' AND w.status = ?'; params.push(status); }
  sql += " ORDER BY CASE w.status WHEN 'pending' THEN 0 WHEN 'contacted' THEN 1 ELSE 2 END, w.created_at DESC";
  res.json({ entries: (await db.prepare(sql).all(...params)).map(shape) });
});

router.post('/', requirePermission('waiting.write'), async (req, res) => {
  const body = req.body || {};
  const { ok, fields } = validate(body, RULES);
  if (!ok) throw badRequest('Veuillez corriger les champs signalés.', fields);

  const patientId = body.patient_id ? Number(body.patient_id) : null;
  let fullName = String(body.full_name || '').trim();
  let phone = String(body.phone || '').trim();

  if (patientId) {
    const p = await db.prepare('SELECT * FROM patients WHERE id = ? AND clinic_id = ?').get(patientId, req.clinicId);
    if (!p) throw badRequest('Patient introuvable.', { patient_id: 'Patient introuvable.' });
    fullName = fullName || `${p.first_name} ${p.last_name}`;
    phone = phone || p.phone;
  }
  if (!fullName) throw badRequest('Le nom du patient est obligatoire.', fields);

  const info = await db
    .prepare(
      `INSERT INTO waiting_list (clinic_id, patient_id, full_name, phone, appointment_type,
                                 desired_date, day_preference, comment, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    )
    .run(
      req.clinicId,
      patientId,
      fullName,
      phone,
      String(body.appointment_type || '').trim(),
      String(body.desired_date || '').trim(),
      String(body.day_preference || '').trim(),
      String(body.comment || '').trim(),
      req.user.id
    );

  await logAction({
    clinicId: req.clinicId,
    user: req.user,
    action: 'waiting_list.created',
    entityType: 'waiting_list',
    entityId: info.lastInsertRowid,
    summary: `${fullName} ajouté(e) à la liste d'attente par ${req.user.name}`,
  });

  const row = await db.prepare(`${SELECT} WHERE w.id = ?`).get(info.lastInsertRowid);
  res.status(201).json({ entry: shape(row) });
});

router.patch('/:id(\\d+)', requirePermission('waiting.write'), async (req, res) => {
  const row = await db.prepare(`${SELECT} WHERE w.id = ? AND w.clinic_id = ?`).get(req.params.id, req.clinicId);
  if (!row) throw notFound('Entrée introuvable.');

  const body = req.body || {};
  const status = body.status && STATUSES.includes(body.status) ? body.status : row.status;
  const appointmentId = body.appointment_id !== undefined ? body.appointment_id : row.appointment_id;

  await db.prepare(
    `UPDATE waiting_list SET status = ?, appointment_id = ?, desired_date = ?, day_preference = ?,
        comment = ? WHERE id = ? AND clinic_id = ?`
  ).run(
    status,
    appointmentId ? Number(appointmentId) : null,
    body.desired_date !== undefined ? String(body.desired_date) : row.desired_date,
    body.day_preference !== undefined ? String(body.day_preference) : row.day_preference,
    body.comment !== undefined ? String(body.comment) : row.comment,
    row.id,
    req.clinicId
  );

  await logAction({
    clinicId: req.clinicId,
    user: req.user,
    action: 'waiting_list.updated',
    entityType: 'waiting_list',
    entityId: row.id,
    summary: `Liste d'attente : ${row.full_name} passe en « ${STATUS_LABELS[status]} » par ${req.user.name}`,
  });

  const updated = await db.prepare(`${SELECT} WHERE w.id = ?`).get(row.id);
  res.json({ entry: shape(updated) });
});

router.delete('/:id(\\d+)', requirePermission('waiting.write'), async (req, res) => {
  const row = await db.prepare('SELECT * FROM waiting_list WHERE id = ? AND clinic_id = ?').get(req.params.id, req.clinicId);
  if (!row) throw notFound('Entrée introuvable.');
  await db.prepare('DELETE FROM waiting_list WHERE id = ? AND clinic_id = ?').run(row.id, req.clinicId);
  await logAction({
    clinicId: req.clinicId,
    user: req.user,
    action: 'waiting_list.deleted',
    entityType: 'waiting_list',
    entityId: row.id,
    summary: `${row.full_name} retiré(e) de la liste d'attente par ${req.user.name}`,
  });
  res.json({ ok: true });
});

export default router;
