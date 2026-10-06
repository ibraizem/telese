/**
 * Routes des indisponibilités ponctuelles : pauses, congés,
 * jours exceptionnels et indisponibilités (par praticien ou cabinet entier).
 */
import { createAsyncRouter } from '../async-router.js';
import db from '../db.js';
import { has, logAction, requireAuth } from '../auth.js';
import { badRequest, isDate, isTime, notFound, validate } from '../errors.js';

const router = createAsyncRouter();
router.use(requireAuth);

const RULES = {
  date: { required: 'La date est obligatoire.' },
  start_time: { required: 'L\'heure de début est obligatoire.' },
  end_time: { required: 'L\'heure de fin est obligatoire.' },
  reason: { required: 'Le motif est obligatoire.' },
};

const REASONS = ['pause', 'conge', 'exception', 'indispo'];
const REASON_LABELS = {
  pause: 'Pause',
  conge: 'Congé',
  exception: 'Jour exceptionnel',
  indispo: 'Indisponibilité',
};

const shape = (b) => ({
  ...b,
  reason_label: REASON_LABELS[b.reason] || b.reason,
  practitioner_name: b.prac_first ? `${b.prac_first} ${b.prac_last}` : null,
});

router.get('/', async (req, res) => {
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  const params = [req.clinicId];
  let sql = `
    SELECT b.*, p.first_name AS prac_first, p.last_name AS prac_last
      FROM blocked_times b
      LEFT JOIN practitioners p ON p.id = b.practitioner_id
     WHERE b.clinic_id = ?`;
  if (isDate(from)) { sql += ' AND b.date >= ?'; params.push(from); }
  if (isDate(to)) { sql += ' AND b.date <= ?'; params.push(to); }
  if (req.query.practitioner_id) { sql += ' AND b.practitioner_id = ?'; params.push(Number(req.query.practitioner_id)); }
  sql += ' ORDER BY b.date, b.start_time';
  res.json({ blocked_times: (await db.prepare(sql).all(...params)).map(shape) });
});

router.post('/', async (req, res) => {
  if (!has(req.user, 'practitioners.manage') && req.user.role === 'practitioner') {
    return res.status(403).json({ error: { code: 'forbidden', message: 'Action non autorisée.' } });
  }
  const body = req.body || {};
  const { ok, fields } = validate(body, RULES);
  if (!ok) throw badRequest('Veuillez corriger les champs signalés.', fields);
  if (!isDate(body.date)) throw badRequest('Date invalide.', { date: 'Format AAAA-MM-JJ attendu.' });
  if (!isTime(body.start_time) || !isTime(body.end_time)) throw badRequest('Horaire invalide.', fields);
  if (body.end_time <= body.start_time) throw badRequest('La fin doit être après le début.', { end_time: 'Horaire invalide.' });
  const reason = REASONS.includes(body.reason) ? body.reason : 'indispo';

  let practitionerId = body.practitioner_id ? Number(body.practitioner_id) : null;
  if (req.user.role === 'practitioner') practitionerId = req.user.practitioner_id; // uniquement les siens
  if (practitionerId) {
    const p = await db.prepare('SELECT id FROM practitioners WHERE id = ? AND clinic_id = ?').get(practitionerId, req.clinicId);
    if (!p) throw badRequest('Orthophoniste introuvable.');
  }

  const info = await db
    .prepare(
      `INSERT INTO blocked_times (clinic_id, practitioner_id, date, start_time, end_time, reason, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.clinicId,
      practitionerId,
      body.date,
      body.start_time,
      body.end_time,
      reason,
      String(body.note || '').trim(),
      req.user.id
    );

  await logAction({
    clinicId: req.clinicId,
    user: req.user,
    action: 'blocked_time.created',
    entityType: 'blocked_time',
    entityId: info.lastInsertRowid,
    summary: `${REASON_LABELS[reason]} ajouté(e) le ${body.date.split('-').reverse().join('/')} par ${req.user.name}`,
  });

  const row = await db
    .prepare(
      `SELECT b.*, p.first_name AS prac_first, p.last_name AS prac_last
         FROM blocked_times b LEFT JOIN practitioners p ON p.id = b.practitioner_id WHERE b.id = ?`
    )
    .get(info.lastInsertRowid);
  res.status(201).json({ blocked_time: shape(row) });
});

router.delete('/:id(\\d+)', async (req, res) => {
  const row = await db
    .prepare(
      `SELECT b.*, p.first_name AS prac_first, p.last_name AS prac_last
         FROM blocked_times b LEFT JOIN practitioners p ON p.id = b.practitioner_id
        WHERE b.id = ? AND b.clinic_id = ?`
    )
    .get(req.params.id, req.clinicId);
  if (!row) throw notFound('Cette indisponibilité n\'existe pas.');
  if (req.user.role === 'practitioner' && row.practitioner_id !== req.user.practitioner_id) {
    throw badRequest('Action non autorisée.');
  }
  if (req.user.role === 'secretary' && !has(req.user, 'practitioners.manage')) {
    // la secrétaire peut annuler une indisponibilité qu'elle a vue : autorisé
  }
  await db.prepare('DELETE FROM blocked_times WHERE id = ? AND clinic_id = ?').run(row.id, req.clinicId);
  await logAction({
    clinicId: req.clinicId,
    user: req.user,
    action: 'blocked_time.deleted',
    entityType: 'blocked_time',
    entityId: row.id,
    summary: `Indisponibilité du ${row.date.split('-').reverse().join('/')} supprimée par ${req.user.name}`,
  });
  res.json({ ok: true });
});

export default router;
