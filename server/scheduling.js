/**
 * Moteur de planification : créneaux disponibles, horaires de travail,
 * pauses, congés et détection de doubles réservations.
 *
 * Toutes les dates/heures sont locales et naïves ("YYYY-MM-DDTHH:MM"),
 * ce qui rend les comparaisons lexicographiques correctes.
 *
 * Toutes les fonctions qui interrogent la base sont désormais asynchrones
 * (voir server/db.js) : elles doivent être appelées avec `await`.
 */
import db from './db.js';
import { dateOf, timeOf, toMinutes, toHHMM } from './errors.js';

/** Statuts qui occupent réellement un créneau. */
export const BLOCKING_STATUSES = ['request', 'confirmed', 'to_confirm', 'done', 'absent'];
/** Statuts qui libèrent le créneau (annulé / reporté ailleurs). */
export const FREEING_STATUSES = ['cancelled', 'postponed'];

export const getClinic = async (clinicId) =>
  db.prepare('SELECT * FROM clinics WHERE id = ?').get(clinicId);

export async function getPractitioner(clinicId, practitionerId) {
  return db
    .prepare('SELECT * FROM practitioners WHERE id = ? AND clinic_id = ?')
    .get(practitionerId, clinicId);
}

/** Horaires hebdomadaires d'un orthophoniste : { 1: [{...}], ... } */
export async function getWeeklyAvailability(practitionerId) {
  const rows = await db
    .prepare('SELECT * FROM availability WHERE practitioner_id = ? ORDER BY weekday, start_time')
    .all(practitionerId);
  const byDay = {};
  for (const r of rows) (byDay[r.weekday] ||= []).push(r);
  return byDay;
}

export const hasCustomAvailability = async (practitionerId) =>
  (await db.prepare('SELECT COUNT(*) AS n FROM availability WHERE practitioner_id = ?').get(practitionerId)).n > 0;

/** Jour ISO : 1 = lundi ... 7 = dimanche. */
export function isoWeekday(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.getDay() === 0 ? 7 : d.getDay();
}

/** Congés / pauses / indisponibilités d'une date (practitioner_id NULL = cabinet). */
export async function getBlockedIntervals(dateStr, practitionerId = null) {
  const rows = await db
    .prepare(
      `SELECT * FROM blocked_times
        WHERE date = ?
          AND (practitioner_id IS NULL OR practitioner_id = ?)`
    )
    .all(dateStr, practitionerId);
  return rows.map((r) => ({
    start: toMinutes(r.start_time),
    end: toMinutes(r.end_time),
    reason: r.reason,
    note: r.note,
    all: r.practitioner_id === null,
    raw: r,
  }));
}

/**
 * Intervalles travaillés pour un praticien à une date.
 * Retourne des intervalles [start, end] en minutes, pauses déduites.
 * Sans configuration personnelle, les horaires du cabinet font foi.
 */
export async function workingIntervals(clinic, dateStr, practitionerId) {
  const weekday = isoWeekday(dateStr);
  const clinicStart = toMinutes(clinic.day_start);
  const clinicEnd = toMinutes(clinic.day_end);

  if (!practitionerId) return [{ start: clinicStart, end: clinicEnd }];

  if (!(await hasCustomAvailability(practitionerId))) {
    return [{ start: clinicStart, end: clinicEnd }];
  }

  const rows = (await getWeeklyAvailability(practitionerId))[weekday] || [];
  const work = rows.filter((r) => r.kind === 'work').map((r) => ({ start: toMinutes(r.start_time), end: toMinutes(r.end_time) }));
  const breaks = rows.filter((r) => r.kind === 'break').map((r) => ({ start: toMinutes(r.start_time), end: toMinutes(r.end_time) }));

  const minus = (intervals, cuts) => {
    let out = intervals;
    for (const cut of cuts) {
      out = out.flatMap((iv) => {
        if (cut.end <= iv.start || cut.start >= iv.end) return [iv];
        const parts = [];
        if (cut.start > iv.start) parts.push({ start: iv.start, end: Math.min(cut.start, iv.end) });
        if (cut.end < iv.end) parts.push({ start: Math.max(cut.end, iv.start), end: iv.end });
        return parts;
      });
    }
    return out;
  };

  const blocked = await getBlockedIntervals(dateStr, practitionerId);
  return minus(work, [...breaks, ...blocked]).filter((iv) => iv.end > iv.start);
}

/** Rendez-vous bloquants d'un praticien pour une date. */
export async function getAppointmentsForDay(clinicId, dateStr, practitionerId = null) {
  const params = [clinicId, `${dateStr}%`];
  let sql = `SELECT a.*, p.first_name AS pat_first, p.last_name AS pat_last
               FROM appointments a
               JOIN patients p ON p.id = a.patient_id
              WHERE a.clinic_id = ? AND a.start_at LIKE ?`;
  if (practitionerId) {
    sql += ' AND practitioner_id = ?';
    params.push(practitionerId);
  }
  sql += ' ORDER BY start_at';
  return db.prepare(sql).all(...params);
}

/**
 * Détecte un chevauchement pour un rendez-vous.
 * @returns {Array} liste des rendez-vous en conflit (vide = OK)
 */
export async function findConflicts({ clinicId, practitionerId, startAt, durationMin, excludeId = null }) {
  if (!practitionerId) return [];
  const date = dateOf(startAt);
  const start = toMinutes(timeOf(startAt));
  const end = start + Number(durationMin);
  const rows = await getAppointmentsForDay(clinicId, date, practitionerId);
  return rows.filter((a) => {
    if (excludeId && a.id === excludeId) return false;
    if (FREEING_STATUSES.includes(a.status)) return false;
    const aStart = toMinutes(timeOf(a.start_at));
    const aEnd = aStart + Number(a.duration_min);
    return start < aEnd && aStart < end;
  });
}

/** Vérifie qu'un praticien travaille bien à ce créneau. */
export async function isWithinWorkingHours(clinic, dateStr, startAt, durationMin, practitionerId) {
  const start = toMinutes(timeOf(startAt));
  const end = start + Number(durationMin);
  const intervals = await workingIntervals(clinic, dateStr, practitionerId);
  return intervals.some((iv) => start >= iv.start && end <= iv.end);
}

/**
 * Génère la grille complète d'une date pour un praticien.
 * @returns {Array<{start,end,status,appointment,reason}>} status ∈
 *  available | occupied | closed | blocked
 */
export async function buildDaySlots({ clinic, dateStr, practitionerId, durationMin, excludeId = null }) {
  const step = Number(clinic.slot_minutes) || 30;
  const clinicStart = toMinutes(clinic.day_start);
  const clinicEnd = toMinutes(clinic.day_end);
  const intervals = await workingIntervals(clinic, dateStr, practitionerId);
  const blocked = await getBlockedIntervals(dateStr, practitionerId);
  const appointments = (await getAppointmentsForDay(clinic.clinic_id ?? clinic.id, dateStr, practitionerId)).filter(
    (a) => !FREEING_STATUSES.includes(a.status) && (!excludeId || a.id !== excludeId)
  );

  const slots = [];
  for (let m = clinicStart; m + Number(durationMin) <= clinicEnd; m += step) {
    const end = m + Number(durationMin);
    const inWork = intervals.some((iv) => m >= iv.start && end <= iv.end);
    const appointment = appointments.find((a) => {
      const s = toMinutes(timeOf(a.start_at));
      const e = s + Number(a.duration_min);
      return m < e && s < end;
    });
    const block = blocked.find((b) => m < b.end && b.start < end);

    let status = 'available';
    let reason = '';
    if (appointment) {
      status = 'occupied';
      reason = 'appointment';
    } else if (block) {
      status = 'blocked';
      reason = block.reason;
    } else if (!inWork) {
      status = 'closed';
      reason = 'hors horaires';
    }
    slots.push({
      start: toHHMM(m),
      end: toHHMM(end),
      startAt: `${dateStr}T${toHHMM(m)}`,
      status,
      reason,
      appointment: appointment || null,
    });
  }
  return slots;
}

/** Prochain créneau disponible à partir d'une date/heure (sur 21 jours). */
export async function nextAvailableSlot({ clinic, clinicId, practitionerId, durationMin, fromDate, fromTime = '00:00' }) {
  for (let i = 0; i < 21; i++) {
    const d = new Date(`${fromDate}T12:00:00`);
    d.setDate(d.getDate() + i);
    const p = (n) => String(n).padStart(2, '0');
    const dateStr = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const slots = await buildDaySlots({ clinic, dateStr, practitionerId, durationMin });
    for (const s of slots) {
      if (s.status === 'available' && (i > 0 || s.start >= fromTime)) return s;
    }
  }
  return null;
}

/** Tous les rendez-vous chevauchant une période (pour la vue agenda). */
export async function appointmentsInRange(clinicId, from, to, practitionerId = null) {
  const params = [clinicId, `${from}%`, `${to}%`];
  let sql = `SELECT * FROM appointments WHERE clinic_id = ? AND start_at >= ? AND start_at <= ?`;
  if (practitionerId) {
    sql += ' AND practitioner_id = ?';
    params.push(practitionerId);
  }
  sql += ' ORDER BY start_at';
  return db.prepare(sql).all(...params);
}
