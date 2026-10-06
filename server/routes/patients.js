/**
 * Routes patients : recherche rapide, fiche, historique des rendez-vous.
 *
 * Rappel V1 : aucune donnée médicale (pas de diagnostic, pas de compte
 * rendu) — uniquement des informations administratives de contact.
 */
import { createAsyncRouter } from '../async-router.js';
import db from '../db.js';
import { logAction, requireAuth, requirePermission } from '../auth.js';
import { badRequest, isEmail, notFound, validate } from '../errors.js';

const router = createAsyncRouter();
router.use(requireAuth);

const PATIENT_RULES = {
  first_name: { required: 'Le prénom est obligatoire.', max: 80 },
  last_name: { required: 'Le nom est obligatoire.', max: 80 },
  phone: { max: 40 },
  whatsapp: { max: 40 },
  email: { max: 120, pattern: isEmail, patternError: 'Adresse e-mail invalide.' },
  guardian_name: { max: 120 },
  guardian_phone: { max: 40 },
  admin_comment: { max: 1000 },
};

const publicPatient = (p) => ({
  id: p.id,
  first_name: p.first_name,
  last_name: p.last_name,
  full_name: `${p.first_name} ${p.last_name}`,
  phone: p.phone,
  whatsapp: p.whatsapp || p.phone,
  email: p.email,
  birth_date: p.birth_date,
  guardian_name: p.guardian_name,
  guardian_phone: p.guardian_phone,
  admin_comment: p.admin_comment,
  created_at: p.created_at,
  appointments_count: p.appointments_count ?? undefined,
  next_appointment: p.next_appointment ?? undefined,
});

/** Recherche rapide : nom, prénom, téléphone (insensible à la casse). */
router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const params = [req.clinicId];
  let sql = `
    SELECT p.*,
      (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.id) AS appointments_count,
      (SELECT MIN(a.start_at) FROM appointments a
         WHERE a.patient_id = p.id AND a.start_at >= datetime('now','localtime')
           AND a.status NOT IN ('cancelled','postponed')) AS next_appointment
    FROM patients p
    WHERE p.clinic_id = ?`;
  if (q) {
    sql += ` AND (lower(p.first_name) LIKE ? OR lower(p.last_name) LIKE ?
                 OR lower(p.first_name || ' ' || p.last_name) LIKE ?
                 OR replace(p.phone,' ','') LIKE replace(?,' ',''))`;
    const like = `%${q.toLowerCase()}%`;
    params.push(like, like, like, `%${q}%`);
  }
  sql += ' ORDER BY p.last_name, p.first_name LIMIT ?';
  params.push(limit);
  const rows = await db.prepare(sql).all(...params);
  res.json({ patients: rows.map(publicPatient) });
});

router.get('/:id(\\d+)', async (req, res) => {
  const p = await db
    .prepare('SELECT * FROM patients WHERE id = ? AND clinic_id = ?')
    .get(req.params.id, req.clinicId);
  if (!p) throw notFound('Patient introuvable.');

  const appointments = (
    await db
      .prepare(
        `SELECT a.*, pr.first_name AS prac_first, pr.last_name AS prac_last, pr.color AS prac_color,
              t.name AS type_name
         FROM appointments a
         LEFT JOIN practitioners pr ON pr.id = a.practitioner_id
         LEFT JOIN appointment_types t ON t.id = a.type_id
        WHERE a.patient_id = ? AND a.clinic_id = ?
        ORDER BY a.start_at DESC
        LIMIT 200`
      )
      .all(p.id, req.clinicId)
  ).map((a) => ({
    ...a,
    practitioner_name: a.prac_first ? `${a.prac_first} ${a.prac_last}` : null,
  }));

  const waitingEntries = await db
    .prepare('SELECT * FROM waiting_list WHERE patient_id = ? AND clinic_id = ? AND status = \'pending\'')
    .all(p.id, req.clinicId);

  res.json({ patient: publicPatient(p), appointments, waiting: waitingEntries });
});

router.post('/', requirePermission('patients.write'), async (req, res) => {
  const body = req.body || {};
  const { ok, fields } = validate(body, PATIENT_RULES);
  if (!ok) throw badRequest('Veuillez corriger les champs signalés.', fields);

  const existing = await db
    .prepare(
      `SELECT id FROM patients WHERE clinic_id = ?
         AND lower(first_name) = lower(?) AND lower(last_name) = lower(?)
         AND replace(phone,' ','') = replace(?,' ','')`
    )
    .get(req.clinicId, body.first_name.trim(), body.last_name.trim(), String(body.phone || '').trim());
  if (existing) throw badRequest('Ce patient existe déjà.', { last_name: 'Patient déjà enregistré.' });

  const info = await db
    .prepare(
      `INSERT INTO patients (clinic_id, first_name, last_name, phone, whatsapp, email, birth_date,
                             guardian_name, guardian_phone, admin_comment, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.clinicId,
      body.first_name.trim(),
      body.last_name.trim(),
      String(body.phone || '').trim(),
      String(body.whatsapp || body.phone || '').trim(),
      String(body.email || '').trim(),
      String(body.birth_date || '').trim(),
      String(body.guardian_name || '').trim(),
      String(body.guardian_phone || '').trim(),
      String(body.admin_comment || '').trim(),
      req.user.id
    );

  await logAction({
    clinicId: req.clinicId,
    user: req.user,
    action: 'patient.created',
    entityType: 'patient',
    entityId: info.lastInsertRowid,
    summary: `Patient créé : ${body.first_name} ${body.last_name} par ${req.user.name}`,
  });

  const created = await db.prepare('SELECT * FROM patients WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ patient: publicPatient(created) });
});

router.patch('/:id(\\d+)', requirePermission('patients.write'), async (req, res) => {
  const p = await db
    .prepare('SELECT * FROM patients WHERE id = ? AND clinic_id = ?')
    .get(req.params.id, req.clinicId);
  if (!p) throw notFound('Patient introuvable.');

  const body = req.body || {};
  const merged = { ...p, ...body };
  const { ok, fields } = validate(merged, PATIENT_RULES);
  if (!ok) throw badRequest('Veuillez corriger les champs signalés.', fields);

  await db.prepare(
    `UPDATE patients SET first_name = ?, last_name = ?, phone = ?, whatsapp = ?, email = ?,
        birth_date = ?, guardian_name = ?, guardian_phone = ?, admin_comment = ?,
        updated_at = datetime('now')
      WHERE id = ? AND clinic_id = ?`
  ).run(
    String(merged.first_name).trim(),
    String(merged.last_name).trim(),
    String(merged.phone || '').trim(),
    String(merged.whatsapp || '').trim(),
    String(merged.email || '').trim(),
    String(merged.birth_date || '').trim(),
    String(merged.guardian_name || '').trim(),
    String(merged.guardian_phone || '').trim(),
    String(merged.admin_comment || '').trim(),
    p.id,
    req.clinicId
  );

  await logAction({
    clinicId: req.clinicId,
    user: req.user,
    action: 'patient.updated',
    entityType: 'patient',
    entityId: p.id,
    summary: `Fiche patient modifiée : ${merged.first_name} ${merged.last_name} par ${req.user.name}`,
  });

  const updated = await db.prepare('SELECT * FROM patients WHERE id = ?').get(p.id);
  res.json({ patient: publicPatient(updated) });
});

/** Suppression réservée à l'administrateur (traçabilité conservée au journal). */
router.delete('/:id(\\d+)', requirePermission('users.manage'), async (req, res) => {
  const p = await db
    .prepare('SELECT * FROM patients WHERE id = ? AND clinic_id = ?')
    .get(req.params.id, req.clinicId);
  if (!p) throw notFound('Patient introuvable.');
  await db.prepare('DELETE FROM patients WHERE id = ? AND clinic_id = ?').run(p.id, req.clinicId);
  await logAction({
    clinicId: req.clinicId,
    user: req.user,
    action: 'patient.deleted',
    entityType: 'patient',
    entityId: p.id,
    summary: `Patient supprimé : ${p.first_name} ${p.last_name} par ${req.user.name}`,
  });
  res.json({ ok: true });
});

export default router;
