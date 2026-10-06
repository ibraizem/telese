/** Utilitaires de dates locales (format AAAA-MM-JJ, sans fuseau). */

const p = (n) => String(n).padStart(2, '0');

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const toISO = (date) => `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;

export const parseISO = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00`);

export const addDays = (iso, days) => {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
};

export const addMonths = (iso, months) => {
  const d = parseISO(iso);
  d.setMonth(d.getMonth() + months);
  return toISO(d);
};

/** 1 = lundi ... 7 = dimanche */
export const isoWeekday = (iso) => {
  const day = parseISO(iso).getDay();
  return day === 0 ? 7 : day;
};

export const startOfWeek = (iso) => addDays(iso, -(isoWeekday(iso) - 1));
export const endOfWeek = (iso) => addDays(startOfWeek(iso), 6);
export const startOfMonth = (iso) => iso.slice(0, 8) + '01';
export const endOfMonth = (iso) => {
  const d = parseISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
};

export const formatDateFr = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export const weekdayName = (iso) => WEEKDAYS[isoWeekday(iso) - 1];

/** « samedi 3 octobre 2026 » */
export const formatLongDate = (iso) => {
  const d = parseISO(iso);
  return `${WEEKDAYS[isoWeekday(iso) - 1]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

/** « sam. 3 oct. » pour les colonnes de l'agenda. */
export const formatShortDate = (iso) => {
  const d = parseISO(iso);
  const short = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
  return `${short[isoWeekday(iso) - 1]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 4)}.`;
};

export const monthLabel = (iso) => {
  const d = parseISO(iso);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

export const isSameDay = (a, b) => String(a).slice(0, 10) === String(b).slice(0, 10);
export const isToday = (iso) => isSameDay(iso, todayISO());

export const timeToMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

export const minutesToTime = (min) => `${p(Math.floor(min / 60))}:${p(min % 60)}`;

export const durationLabel = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60}` : ''}` : `${min} min`);

/** Index du créneau dans la grille de l'agenda. */
export const range = (from, to, step) => {
  const out = [];
  for (let m = from; m <= to; m += step) out.push(m);
  return out;
};
