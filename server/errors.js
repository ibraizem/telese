/**
 * Erreurs applicatives + validateurs simples.
 * Toutes les réponses d'erreur ont la forme { error: { code, message, fields? } }.
 */

export class ApiError extends Error {
  constructor(status, message, code = 'error', fields = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const badRequest = (msg, fields = null) => new ApiError(400, msg, 'bad_request', fields);
export const unauthorized = (msg = 'Authentification requise.') => new ApiError(401, msg, 'unauthorized');
export const forbidden = (msg = 'Accès non autorisé.') => new ApiError(403, msg, 'forbidden');
export const notFound = (msg = 'Ressource introuvable.') => new ApiError(404, msg, 'not_found');
export const conflict = (msg, fields = null) => new ApiError(409, msg, 'conflict', fields);

/** Validation « champ par champ » : renvoie { ok, fields }. */
export function validate(values, rules) {
  const fields = {};
  for (const [field, ruleset] of Object.entries(rules)) {
    const v = values[field];
    const str = v === undefined || v === null ? '' : String(v).trim();
    if (ruleset.required && !str) fields[field] = ruleset.required;
    else if (str && ruleset.pattern) {
      // Soit une RegExp, soit une fonction de validation (ex. isEmail).
      const valid = typeof ruleset.pattern.test === 'function' ? ruleset.pattern.test(str) : !!ruleset.pattern(str);
      if (!valid) fields[field] = ruleset.patternError || 'Format invalide.';
    }
    else if (str && ruleset.max && str.length > ruleset.max) fields[field] = `Maximum ${ruleset.max} caractères.`;
  }
  const ok = Object.keys(fields).length === 0;
  return { ok, fields };
}

export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s));
export const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
export const isDateTime = (s) => {
  const str = String(s || '');
  return isDate(str.slice(0, 10)) && str[10] === 'T' && isTime(str.slice(11, 16)) && str.length === 16;
};
export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));

/** Minutes depuis minuit ("09:30" -> 570). */
export const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};
/** "09:30" <- minutes depuis minuit. */
export const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** Ajoute des minutes à un "YYYY-MM-DDTHH:MM". */
export const addMinutes = (dateTime, minutes) => {
  const [d, t] = dateTime.split('T');
  const dt = new Date(`${d}T${t}:00`);
  dt.setMinutes(dt.getMinutes() + minutes);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}T${p(dt.getHours())}:${p(dt.getMinutes())}`;
};
export const dateOf = (dateTime) => String(dateTime).slice(0, 10);
export const timeOf = (dateTime) => String(dateTime).slice(11, 16);
