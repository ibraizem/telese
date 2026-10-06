/**
 * Statistiques du cabinet : volumes, statuts, nouveaux patients,
 * demandes et taux de transformation demande → rendez-vous.
 *
 * Périmètre : aujourd'hui / cette semaine / ce mois (ou plage libre).
 * `initial_status` conserve le statut à la création, ce qui permet de
 * mesurer le taux de transformation des demandes.
 */
import { createAsyncRouter } from '../async-router.js';
import db from '../db.js';
import { requireAuth, requirePermission } from '../auth.js';
import { badRequest, isDate } from '../errors.js';

const router = createAsyncRouter();
router.use(requireAuth);
// Les statistiques du cabinet sont réservées à l'administrateur.
router.use(requirePermission('stats.view'));

const p = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;

function periodRange(period, from, to) {
  const now = new Date();
  if (period === 'custom' && isDate(from) && isDate(to)) return { from, to };
  if (period === 'today') return { from: iso(now), to: iso(now) };
  if (period === 'week') {
    const day = now.getDay() === 0 ? 7 : now.getDay(); // lundi = 1
    const start = new Date(now);
    start.setDate(now.getDate() - (day - 1));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { from: iso(start), to: iso(end) };
  }
  // mois par défaut
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: iso(start), to: iso(end) };
}

router.get('/', async (req, res) => {
  const { period = 'month' } = req.query;
  const range = periodRange(period, req.query.from, req.query.to);
  if (!isDate(range.from) || !isDate(range.to)) throw badRequest('Période invalide.');

  const clinicId = req.clinicId;

  const byStatus = await db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM appointments
        WHERE clinic_id = ? AND date(start_at) BETWEEN ? AND ? GROUP BY status`
    )
    .all(clinicId, range.from, range.to);
  const statuses = Object.fromEntries(byStatus.map((r) => [r.status, r.n]));
  const total = byStatus.reduce((s, r) => s + r.n, 0);

  const newPatients = (
    await db
      .prepare("SELECT COUNT(*) AS n FROM patients WHERE clinic_id = ? AND date(created_at,'localtime') BETWEEN ? AND ?")
      .get(clinicId, range.from, range.to)
  ).n;

  const demandRow = await db
    .prepare(
      `SELECT COUNT(*) AS n,
              SUM(CASE WHEN status IN ('confirmed','done','absent') THEN 1 ELSE 0 END) AS converted
         FROM appointments
        WHERE clinic_id = ? AND initial_status = 'request' AND date(start_at) BETWEEN ? AND ?`
    )
    .get(clinicId, range.from, range.to);
  const demandes = demandRow.n || 0;
  const converted = demandRow.converted || 0;

  const waiting = (
    await db
      .prepare("SELECT COUNT(*) AS n FROM waiting_list WHERE clinic_id = ? AND status = 'pending'")
      .get(clinicId)
  ).n;

  const daily = await db
    .prepare(
      `SELECT date(start_at) AS day,
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
              SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
         FROM appointments
        WHERE clinic_id = ? AND date(start_at) BETWEEN ? AND ?
        GROUP BY day ORDER BY day`
    )
    .all(clinicId, range.from, range.to);

  res.json({
    period,
    from: range.from,
    to: range.to,
    total,
    statuses: {
      request: statuses.request || 0,
      confirmed: statuses.confirmed || 0,
      to_confirm: statuses.to_confirm || 0,
      cancelled: statuses.cancelled || 0,
      postponed: statuses.postponed || 0,
      done: statuses.done || 0,
      absent: statuses.absent || 0,
    },
    new_patients: newPatients,
    waiting_list: waiting,
    demandes,
    demandes_converties: converted,
    transformation_rate: demandes ? Math.round((converted / demandes) * 100) : 0,
    daily,
  });
});

export default router;
