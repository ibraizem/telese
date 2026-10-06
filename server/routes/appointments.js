/**
 * Routes rendez-vous : lecture agenda, création, modification, annulation,
 * suppression, créneaux disponibles et anti-double-réservation.
 */
import { createAsyncRouter } from '../async-router.js';
import db from '../db.js';
import { logAction, requireAuth, requirePermission } from '../auth.js';
import { badRequest, conflict, forbidden, isDateTime, notFound, validate } from '../errors.js';
import {
  buildDaySlots,
  findConflicts,
  getClinic,
  getPractitioner,
  isWithinWorkingHours,
  nextAvailableSlot,
} from '../scheduling.js';

const router = createAsyncRouter();
router.use(requireAuth);

export const STATUSES = [
  { key: 'request', label: 'Demande' },
  { key: 'confirmed', label: 'Confirmé' },
  { key: 'to_confirm', label: 'À confirmer' },
  { key: 'cancelled', label: 'Annulé' },
  { key: 'postponed', label: 'Reporté' },
  { key: 'done', label: 'Terminé' },
  { key: 'absent', label: 'Patient absent' },
];

const APPT_RULES = {
  patient_id: { required: 'Sélectionnez un patient.' },
  practitioner_id: { required: 'Sélectionnez un orthophoniste.' },
  start_at: { required: 'La date et l\'heure sont obligatoires.' },
  duration_min: { required: 'La durée est obligatoire.' },
  status: { required: 'Le statut est obligatoire.' },
};

const SELECT = `
  SELECT a.*,
         p.first_name AS pat_first, p.last_name AS pat_last, p.phone AS pat_phone,
         p.guardian_name AS pat_guardian, p.email AS pat_email,
         pr.first_name AS prac_first, pr.last_name AS prac_last, pr.color AS prac_color,
         t.name AS type_name, t.color AS type_color,
         u.name AS created_by_name
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    LEFT JOIN practitioners pr ON pr.id = a.practitioner_id
    LEFT JOIN appointment_types t ON t.id = a.type_id
    LEFT JOIN users u ON u.id = a.created_by`;

const shape = (a) => ({
  id: a.id,
  clinic_id: a.clinic_id,
  patient_id: a.patient_id,
  practitioner_id: a.practitioner_id,
  type_id: a.type_id,
  start_at: a.start_at,
  date: a.start_at.slice(0, 10),
  time: a.start_at.slice(11, 16),
  duration_min: a.duration_min,
  status: a.status,
  comment: a.comment,
  created_by_name: a.created_by_name,
  created_at: a.created_at,
  updated_at: a.updated_at,
  patient: {
    id: a.patient_id,
    first_name: a.pat_first,
    last_name: a.pat_last,
    full_name: `${a.pat_first} ${a.pat_last}`,
    phone: a.pat_phone,
    email: a.pat_email,
    guardian_name: a.pat_guardian,
  },
  practitioner: a.practitioner_id
    ? { id: a.practitioner_id, full_name: `${a.prac_first} ${a.prac_last}`, color: a.prac_color }
    : null,
  type: a.type_id ? { id: a.type_id, name: a.type_name, color: a.type_color } : null,
});

/** Lecture de l'agenda : plage + filtres. */
router.get('/', async (req, res) => {
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw badRequest('Paramètres from/to attendus au format AAAA-MM-JJ.');
  }
  let practitionerId = req.query.practitioner_id ? Number(req.query.practitioner_id) : null;
  // Un orthophoniste ne consulte que son propre agenda.
  if (req.user.role === 'practitioner') practitionerId = req.user.practitioner_id;

  const rows = (
    await db
      .prepare(`${SELECT} WHERE a.clinic_id = ? AND date(a.start_at) >= ? AND date(a.start_at) <= ?`)
      .all(req.clinicId, from, to)
  )
    .filter((a) => !practitionerId || a.practitioner_id === practitionerId)
    .filter((a) => !req.query.patient_id || a.patient_id === Number(req.query.patient_id))
    .filter((a) => !req.query.status || a.status === req.query.status);

  res.json({ appointments: rows.map(shape) });
});

router.get('/statuses', (_req, res) => res.json({ statuses: STATUSES }));

router.get('/:id(\\d+)', async (req, res) => {
  const row = await db.prepare(`${SELECT} WHERE a.id = ? AND a.clinic_id = ?`).get(req.params.id, req.clinicId);
  if (!row) throw notFound('Rendez-vous introuvable.');
  if (req.user.role === 'practitioner' && row.practitioner_id !== req.user.practitioner_id) {
    throw forbidden('Ce rendez-vous ne vous concerne pas.');
  }
  res.json({ appointment: shape(row) });
});

/** Créneaux d'une date pour un orthophoniste (occupés / libres / fermés). */
router.get('/meta/slots', async (req, res) => {
  const date = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('Paramètre date attendu.');
  const clinic = await getClinic(req.clinicId);
  const duration = Number(req.query.duration) || 30;
  let practitionerId = Number(req.query.practitioner_id) || null;
  if (req.user.role === 'practitioner') practitionerId = req.user.practitioner_id;
  const exclude = req.query.exclude ? Number(req.query.exclude) : null;
  res.json({
    slots: await buildDaySlots({ clinic, dateStr: date, practitionerId, durationMin: duration, excludeId: exclude }),
    slot_minutes: clinic.slot_minutes,
  });
});

/** Prochain créneau disponible (raccourci « créneau suivant disponible »). */
router.get('/meta/next-available', async (req, res) => {
  const clinic = await getClinic(req.clinicId);
  const duration = Number(req.query.duration) || 30;
  let practitionerId = Number(req.query.practitioner_id) || null;
  if (req.user.role === 'practitioner') practitionerId = req.user.practitioner_id;
  const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '')
    ? req.query.date
    : new Date().toISOString().slice(0, 10);
  const slot = await nextAvailableSlot({
    clinic,
    clinicId: req.clinicId,
    practitionerId,
    durationMin: duration,
    fromDate,
    fromTime: req.query.from || '00:00',
  });
  res.json({ slot, practitioner_id: practitionerId });
});

/** Vérifie un créneau avant d'ouvrir le formulaire (retourne les conflits). */
router.get('/meta/check', async (req, res) => {
  const clinic = await getClinic(req.clinicId);
  const startAt = String(req.query.start_at || '');
  const duration = Number(req.query.duration) || 30;
  const practitionerId = Number(req.query.practitioner_id) || null;
  const exclude = req.query.exclude ? Number(req.query.exclude) : null;
  if (!isDateTime(startAt)) throw badRequest('Paramètre start_at attendu (AAAA-MM-JJTHH:MM).');

  const conflicts = await findConflicts({ clinicId: req.clinicId, practitionerId, startAt, durationMin: duration, excludeId: exclude });
  const inHours = await isWithinWorkingHours(clinic, startAt.slice(0, 10), startAt, duration, practitionerId);
  res.json({
    available: conflicts.length === 0 && inHours,
    conflicts: conflicts.map((a) => ({
      id: a.id,
      start_at: a.start_at,
      duration_min: a.duration_min,
      status: a.status,
      patient: { full_name: `${a.pat_first} ${a.pat_last}`, phone: a.pat_phone || '' },
    })),
    in_working_hours: inHours,
  });
});

async function assertBookable(req, { startAt, duration, practitionerId, excludeId = null, patientId }) {
  if (!isDateTime(startAt)) return badRequest('Date et heure invalides.');
  const durationMin = Number(duration);
  if (!Number.isFinite(durationMin) || durationMin < 5 || durationMin > 480) {
    return badRequest('Durée invalide (5 à 480 minutes).', { duration_min: 'Durée invalide.' });
  }
  const patient = await db.prepare('SELECT id FROM patients WHERE id = ? AND clinic_id = ?').get(patientId, req.clinicId);
  if (!patient) return badRequest('Patient introuvable.', { patient_id: 'Patient introuvable.' });
  const practitioner = await getPractitioner(req.clinicId, practitionerId);
  if (!practitioner) return badRequest('Orthophoniste introuvable.', { practitioner_id: 'Orthophoniste introuvable.' });

  // Un orthophoniste ne crée/modifie que ses propres rendez-vous.
  if (req.user.role === 'practitioner' && practitionerId !== req.user.practitioner_id) {
    return forbidden('Vous ne pouvez gérer que vos propres rendez-vous.');
  }

  const clinic = await getClinic(req.clinicId);
  const date = startAt.slice(0, 10);
  const busy = await findConflicts({ clinicId: req.clinicId, practitionerId, startAt, durationMin, excludeId });
  if (busy.length) {
    const a = busy[0];
    const when = `${a.start_at.slice(0, 10).split('-').reverse().join('/')} à ${a.start_at.slice(11)}`;
    return conflict(
      `Créneau déjà occupé : rendez-vous de ${a.pat_first} ${a.pat_last} le ${when} (${a.duration_min} min).`,
      { start_at: 'Créneau indisponible' }
    );
  }
  if (!(await isWithinWorkingHours(clinic, date, startAt, durationMin, practitionerId))) {
    return conflict('Ce créneau est en dehors des horaires de travail ou pendant une pause/congé.', {
      start_at: 'Hors horaires de travail',
    });
  }
  return null;
}

router.post('/', requirePermission('agenda.write'), async (req, res) => {
  const body = req.body || {};
  const { ok, fields } = validate(body, APPT_RULES);
  if (!ok) throw badRequest('Veuillez corriger les champs signalés.', fields);

  const startAt = String(body.start_at);
  const error = await assertBookable(req, {
    startAt,
    duration: body.duration_min,
    practitionerId: Number(body.practitioner_id),
    patientId: Number(body.patient_id),
  });
  if (error) throw error;

  const status = STATUSES.some((s) => s.key === body.status) ? body.status : 'confirmed';
  const info = await db
    .prepare(
      `INSERT INTO appointments (clinic_id, patient_id, practitioner_id, type_id, start_at, duration_min,
                                 status, initial_status, comment, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.clinicId,
      Number(body.patient_id),
      Number(body.practitioner_id),
      body.type_id ? Number(body.type_id) : null,
      startAt,
      Number(body.duration_min),
      status,
      status,
      String(body.comment || '').trim(),
      req.user.id,
      req.user.id
    );

  const patient = await db.prepare('SELECT first_name, last_name FROM patients WHERE id = ?').get(body.patient_id);
  const when = `${startAt.slice(0, 10).split('-').reverse().join('/')} à ${startAt.slice(11, 16)}`;
  await logAction({
    clinicId: req.clinicId,
    user: req.user,
    action: 'appointment.created',
    entityType: 'appointment',
    entityId: info.lastInsertRowid,
    summary: `Rendez-vous créé pour ${patient.first_name} ${patient.last_name} le ${when} par ${req.user.name}`,
  });

  const row = await db.prepare(`${SELECT} WHERE a.id = ?`).get(info.lastInsertRowid);
  res.status(201).json({ appointment: shape(row) });
});

router.patch('/:id(\\d+)', requirePermission('agenda.write'), async (req, res) => {
  const current = await db.prepare(`${SELECT} WHERE a.id = ? AND a.clinic_id = ?`).get(req.params.id, req.clinicId);
  if (!current) throw notFound('Rendez-vous introuvable.');
  if (req.user.role === 'practitioner' && current.practitioner_id !== req.user.practitioner_id) {
    throw forbidden('Ce rendez-vous ne vous concerne pas.');
  }

  const body = { ...current, ...(req.body || {}) };
  const { ok, fields } = validate(body, APPT_RULES);
  if (!ok) throw badRequest('Veuillez corriger les champs signalés.', fields);

  const startAt = String(body.start_at);
  const error = await assertBookable(req, {
    startAt,
    duration: body.duration_min,
    practitionerId: Number(body.practitioner_id),
    patientId: Number(body.patient_id),
    excludeId: current.id,
  });
  if (error) throw error;

  const status = STATUSES.some((s) => s.key === body.status) ? body.status : current.status;
  const moved = startAt !== current.start_at;
  await db.prepare(
    `UPDATE appointments SET patient_id = ?, practitioner_id = ?, type_id = ?, start_at = ?,
        duration_min = ?, status = ?, comment = ?, updated_by = ?, updated_at = datetime('now')
      WHERE id = ? AND clinic_id = ?`
  ).run(
    Number(body.patient_id),
    Number(body.practitioner_id),
    body.type_id ? Number(body.type_id) : null,
    startAt,
    Number(body.duration_min),
    status,
    String(body.comment || '').trim(),
    req.user.id,
    current.id,
    req.clinicId
  );

  const when = `${startAt.slice(0, 10).split('-').reverse().join('/')} à ${startAt.slice(11, 16)}`;
  await logAction({
    clinicId: req.clinicId,
    user: req.user,
    action: moved ? 'appointment.moved' : 'appointment.updated',
    entityType: 'appointment',
    entityId: current.id,
    summary: `${moved ? 'Rendez-vous déplacé' : 'Rendez-vous modifié'} : ${current.pat_first} ${current.pat_last} le ${when} par ${req.user.name}`,
  });

  const row = await db.prepare(`${SELECT} WHERE a.id = ?`).get(current.id);
  res.json({ appointment: shape(row) });
});

/** Changement rapide de statut depuis l'agenda (terminé, absent, annulé...). */
router.post('/:id(\\d+)/status', requirePermission('agenda.write'), async (req, res) => {
  const current = await db.prepare(`${SELECT} WHERE a.id = ? AND a.clinic_id = ?`).get(req.params.id, req.clinicId);
  if (!current) throw notFound('Rendez-vous introuvable.');
  if (req.user.role === 'practitioner' && current.practitioner_id !== req.user.practitioner_id) {
    throw forbidden('Ce rendez-vous ne vous concerne pas.');
  }
  const status = String(req.body?.status || '');
  if (!STATUSES.some((s) => s.key === status)) throw badRequest('Statut invalide.');

  await db.prepare('UPDATE appointments SET status = ?, updated_by = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(status, req.user.id, current.id);

  const label = STATUSES.find((s) => s.key === status).label;
  await logAction({
    clinicId: req.clinicId,
    user: req.user,
    action: 'appointment.status',
    entityType: 'appointment',
    entityId: current.id,
    summary: `Rendez-vous de ${current.pat_first} ${current.pat_last} marqué « ${label} » par ${req.user.name}`,
  });

  const row = await db.prepare(`${SELECT} WHERE a.id = ?`).get(current.id);
  res.json({ appointment: shape(row) });
});

router.delete('/:id(\\d+)', requirePermission('agenda.write'), async (req, res) => {
  const current = await db.prepare(`${SELECT} WHERE a.id = ? AND a.clinic_id = ?`).get(req.params.id, req.clinicId);
  if (!current) throw notFound('Rendez-vous introuvable.');
  if (req.user.role === 'practitioner') throw forbidden('Suppression non autorisée pour votre rôle.');

  await db.prepare('DELETE FROM appointments WHERE id = ? AND clinic_id = ?').run(current.id, req.clinicId);
  await logAction({
    clinicId: req.clinicId,
    user: req.user,
    action: 'appointment.deleted',
    entityType: 'appointment',
    entityId: current.id,
    summary: `Rendez-vous supprimé : ${current.pat_first} ${current.pat_last} du ${current.start_at.slice(0, 10).split('-').reverse().join('/')} par ${req.user.name}`,
  });
  res.json({ ok: true });
});

export default router;
export { shape as shapeAppointment, SELECT as APPOINTMENT_SELECT };
