/**
 * Routes de communication (V1 : génération de messages uniquement).
 *
 * L'application ne contacte aucun service tiers pour l'instant : elle
 * produit le texte, le copie dans le presse-papiers, ouvre WhatsApp Web
 * (wa.me) / le client mail. L'architecture (table `messages`, templates
 * centralisés, canal renseigné) permet de brancher en V2 l'API WhatsApp
 * Business, un SMTP transactionnel ou un SMS sans changer le modèle.
 */
import { createAsyncRouter } from '../async-router.js';
import db from '../db.js';
import { logAction, requireAuth, requirePermission } from '../auth.js';
import { badRequest, notFound } from '../errors.js';

const router = createAsyncRouter();
router.use(requireAuth);

export const DEFAULT_TEMPLATES = [
  {
    key: 'confirmation',
    name: 'Confirmation',
    body: 'Bonjour [Prénom], votre rendez-vous au cabinet d\'orthophonie est confirmé pour le [Date] à [Heure].',
  },
  {
    key: 'reminder',
    name: 'Rappel',
    body: 'Bonjour [Prénom], nous vous rappelons votre rendez-vous au cabinet d\'orthophonie prévu le [Date] à [Heure].',
  },
  {
    key: 'cancellation',
    name: 'Annulation',
    body: 'Bonjour [Prénom], votre rendez-vous du [Date] à [Heure] a bien été annulé.',
  },
  {
    key: 'postponement',
    name: 'Report',
    body: 'Bonjour [Prénom], votre rendez-vous a été déplacé au [Date] à [Heure].',
  },
];

/** Crée les modèles par défaut du cabinet s'ils n'existent pas encore. */
export async function ensureDefaultTemplates(clinicId) {
  const ins = db.prepare('INSERT OR IGNORE INTO message_templates (clinic_id, template_key, name, body) VALUES (?, ?, ?, ?)');
  for (const t of DEFAULT_TEMPLATES) await ins.run(clinicId, t.key, t.name, t.body);
}

const frDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

router.get('/templates', async (req, res) => {
  await ensureDefaultTemplates(req.clinicId);
  res.json({
    templates: await db
      .prepare('SELECT * FROM message_templates WHERE clinic_id = ? ORDER BY id')
      .all(req.clinicId),
  });
});

/** Enregistre les modèles personnalisés du cabinet. */
router.put('/templates', requirePermission('clinic.manage'), async (req, res) => {
  await ensureDefaultTemplates(req.clinicId);
  const list = Array.isArray(req.body?.templates) ? req.body.templates : [];
  const upd = db.prepare('UPDATE message_templates SET name = ?, body = ? WHERE clinic_id = ? AND template_key = ?');
  for (const t of list) {
    const body = String(t.body || '').trim();
    if (!body) throw badRequest('Le contenu d\'un modèle ne peut pas être vide.');
    await upd.run(String(t.name || t.template_key), body, req.clinicId, String(t.template_key));
  }
  await logAction({
    clinicId: req.clinicId, user: req.user, action: 'message_templates.updated',
    entityType: 'message_template', entityId: null,
    summary: `Modèles de message modifiés par ${req.user.name}`,
  });
  res.json({ templates: await db.prepare('SELECT * FROM message_templates WHERE clinic_id = ? ORDER BY id').all(req.clinicId) });
});

/** Remplit un modèle : [Prénom] [Nom] [Date] [Heure] [Téléphone]. */
router.post('/render', async (req, res) => {
  const { template_key, patient_id, appointment_id, first_name, date, time } = req.body || {};
  const tpl = await db
    .prepare('SELECT * FROM message_templates WHERE clinic_id = ? AND template_key = ?')
    .get(req.clinicId, String(template_key || ''));
  if (!tpl) throw notFound('Modèle introuvable.');

  let patient = null;
  let whenDate = date || '';
  let whenTime = time || '';

  if (appointment_id) {
    const appt = await db
      .prepare(
        `SELECT a.*, p.first_name, p.last_name, p.phone FROM appointments a
           JOIN patients p ON p.id = a.patient_id WHERE a.id = ? AND a.clinic_id = ?`
      )
      .get(appointment_id, req.clinicId);
    if (appt) {
      patient = appt;
      whenDate = whenDate || appt.start_at.slice(0, 10);
      whenTime = whenTime || appt.start_at.slice(11, 16);
    }
  }
  if (!patient && patient_id) {
    patient = await db.prepare('SELECT * FROM patients WHERE id = ? AND clinic_id = ?').get(patient_id, req.clinicId);
    if (!patient) throw notFound('Patient introuvable.');
  }

  const body = tpl.body
    .replaceAll('[Prénom]', patient ? patient.first_name : String(first_name || '').trim())
    .replaceAll('[Nom]', patient ? patient.last_name : '')
    .replaceAll('[Date]', frDate(whenDate))
    .replaceAll('[Heure]', whenTime)
    .replaceAll('[Téléphone]', patient ? patient.phone : '');

  res.json({ template_key: tpl.key, name: tpl.name, body });
});

/** Journalise un message généré (copie / whatsapp / email). */
router.post('/', requirePermission('messages.send'), async (req, res) => {
  const { template_key, channel, body, patient_id, appointment_id } = req.body || {};
  if (!body || !String(body).trim()) throw badRequest('Le message est vide.');
  const chan = ['copy', 'whatsapp', 'email'].includes(channel) ? channel : 'copy';
  const info = await db
    .prepare(
      `INSERT INTO messages (clinic_id, patient_id, appointment_id, template_key, channel, body, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.clinicId,
      patient_id ? Number(patient_id) : null,
      appointment_id ? Number(appointment_id) : null,
      String(template_key || 'custom'),
      chan,
      String(body),
      req.user.id
    );
  await logAction({
    clinicId: req.clinicId,
    user: req.user,
    action: 'message.generated',
    entityType: 'message',
    entityId: info.lastInsertRowid,
    summary: `Message « ${template_key} » généré (${chan}) par ${req.user.name}`,
  });
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

router.get('/history', async (req, res) => {
  const params = [req.clinicId];
  let sql = `SELECT m.*, p.first_name, p.last_name FROM messages m
              LEFT JOIN patients p ON p.id = m.patient_id WHERE m.clinic_id = ?`;
  if (req.query.patient_id) { sql += ' AND m.patient_id = ?'; params.push(Number(req.query.patient_id)); }
  sql += ' ORDER BY m.created_at DESC LIMIT 100';
  res.json({ messages: await db.prepare(sql).all(...params) });
});

export default router;
