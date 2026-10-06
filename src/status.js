/** Statuts de rendez-vous et libellés partagés (interface + messages). */

export const STATUS = {
  request: { label: 'Demande', className: 'is-request', icon: '◷' },
  confirmed: { label: 'Confirmé', className: 'is-confirmed', icon: '✓' },
  to_confirm: { label: 'À confirmer', className: 'is-to_confirm', icon: '?' },
  cancelled: { label: 'Annulé', className: 'is-cancelled', icon: '×' },
  postponed: { label: 'Reporté', className: 'is-postponed', icon: '→' },
  done: { label: 'Terminé', className: 'is-done', icon: '✓' },
  absent: { label: 'Patient absent', className: 'is-absent', icon: '!' },
};

export const STATUS_LIST = Object.entries(STATUS).map(([key, v]) => ({ key, label: v.label }));

export const statusMeta = (key) => STATUS[key] || { label: key, className: '', icon: '' };

export const ROLES = {
  admin: 'Administrateur',
  secretary: 'Télésecrétaire',
  practitioner: 'Orthophoniste',
};

export const WAITING_STATUS = {
  pending: 'En attente',
  contacted: 'Patient contacté',
  scheduled: 'Placé',
  removed: 'Retiré',
};

export const BLOCK_REASONS = {
  pause: 'Pause',
  conge: 'Congé',
  exception: 'Jour exceptionnel',
  indispo: 'Indisponibilité',
};

export const WEEKDAYS = [
  { n: 1, short: 'Lun', long: 'Lundi' },
  { n: 2, short: 'Mar', long: 'Mardi' },
  { n: 3, short: 'Mer', long: 'Mercredi' },
  { n: 4, short: 'Jeu', long: 'Jeudi' },
  { n: 5, short: 'Ven', long: 'Vendredi' },
  { n: 6, short: 'Sam', long: 'Samedi' },
  { n: 7, short: 'Dim', long: 'Dimanche' },
];
