/**
 * Tests automatisés des 10 scénarios imposés par le cahier des charges.
 *
 * Usage : npm test
 *
 * Le script crée une base de test jetée (data/smoke-test.db), la remplit de
 * données de démonstration, démarre le serveur sur un port dédié, exécute les
 * scénarios puis arrête tout. Aucune donnée de travail n'est modifiée.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const DB_PATH = path.join(root, 'data', 'smoke-test.db');
const PORT = 4123;
const BASE = `http://localhost:${PORT}`;
const env = { ...process.env, DB_PATH, PORT: String(PORT), NODE_ENV: 'test' };

let passed = 0;
let failed = 0;
const results = [];

function check(label, condition, detail = '') {
  if (condition) {
    passed++;
    results.push(`  ✓ ${label}`);
  } else {
    failed++;
    results.push(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Client HTTP minimal qui conserve le cookie de session. */
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(`${BASE}${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    let json = null;
    try { json = await res.json(); } catch { /* réponse vide */ }
    return { status: res.status, body: json };
  };
}

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Préparation                                                          */
/* ------------------------------------------------------------------ */
fs.rmSync(DB_PATH, { force: true });
fs.rmSync(`${DB_PATH}-wal`, { force: true });
fs.rmSync(`${DB_PATH}-shm`, { force: true });

const seed = spawnSync('node', [path.join(root, 'server', 'seed.js'), '--fresh'], { env, stdio: 'pipe' });
if (seed.status !== 0) {
  console.error('Échec du seed :', seed.stderr?.toString());
  process.exit(1);
}

const server = spawn('node', [path.join(root, 'server', 'index.js')], { env, stdio: 'ignore' });
const stop = () => { try { server.kill('SIGTERM'); } catch { /* déjà arrêté */ } };
process.on('exit', stop);

try {
  if (!(await waitForServer())) {
    console.error('Le serveur de test n\'a pas démarré.');
    process.exit(1);
  }

  const admin = client();
  const secretary = client();
  const practitioner = client();

  /* Connexions ----------------------------------------------------- */
  const loginAdmin = await admin('POST', '/api/auth/login', { email: 'sophie@cabinet.ma', password: 'Demo1234' });
  check('10. Connexion administrateur', loginAdmin.status === 200 && loginAdmin.body.user.role === 'admin');
  const loginSec = await secretary('POST', '/api/auth/login', { email: 'imane@cabinet.ma', password: 'Demo1234' });
  check('10. Connexion télésecrétaire', loginSec.status === 200 && loginSec.body.user.role === 'secretary');
  const loginPrac = await practitioner('POST', '/api/auth/login', { email: 'nadia@cabinet.ma', password: 'Demo1234' });
  check('10. Connexion orthophoniste', loginPrac.status === 200 && loginPrac.body.user.role === 'practitioner');
  const anon = client();
  const badLogin = await anon('POST', '/api/auth/login', { email: 'sophie@cabinet.ma', password: 'mauvais' });
  check('10. Mot de passe incorrect refusé', badLogin.status === 401);

  /* 1. Créer un patient -------------------------------------------- */
  const newPatient = await secretary('POST', '/api/patients', {
    first_name: 'Test', last_name: 'Scénario',
    phone: '+212 600 00 00 01', email: 'test.scenario@example.ma',
  });
  check('1. Créer un patient', newPatient.status === 201 && newPatient.body.patient.id > 0,
    `status=${newPatient.status}`);
  const patientId = newPatient.body.patient.id;

  /* 7. Rechercher un patient --------------------------------------- */
  const search = await secretary('GET', '/api/patients?q=sc%C3%A9nario');
  check('7. Rechercher un patient par nom', search.status === 200 && search.body.patients.length === 1);
  const searchPhone = await secretary('GET', '/api/patients?q=600%2000%2000%2001');
  check('7. Rechercher un patient par téléphone', searchPhone.body.patients.some((p) => p.id === patientId));

  /* 3. Empêcher un double rendez-vous ------------------------------ */
  const slot = await secretary('GET', '/api/appointments/meta/next-available?date=2030-01-07&practitioner_id=1&duration=30');
  const startAt = slot.body.slot?.startAt || '2030-01-07T09:00';

  /* 2. Créer un rendez-vous ---------------------------------------- */
  const appt = await secretary('POST', '/api/appointments', {
    patient_id: patientId, practitioner_id: 1, type_id: 2,
    start_at: startAt, duration_min: 30, status: 'confirmed', comment: 'scénario de test',
  });
  check('2. Créer un rendez-vous', appt.status === 201 && appt.body.appointment.id > 0, `status=${appt.status}`);
  const apptId = appt.body.appointment?.id;

  const doubleBooking = await secretary('POST', '/api/appointments', {
    patient_id: 1, practitioner_id: 1, type_id: 2,
    start_at: startAt, duration_min: 30, status: 'confirmed',
  });
  check('3. Double réservation refusée (409)', doubleBooking.status === 409, `status=${doubleBooking.status}`);

  const outsideHours = await secretary('POST', '/api/appointments', {
    patient_id: 1, practitioner_id: 1, type_id: 2,
    start_at: `${startAt.slice(0, 10)}T22:30`, duration_min: 30, status: 'confirmed',
  });
  check('3. Rendez-vous hors horaires refusé (409)', outsideHours.status === 409, `status=${outsideHours.status}`);

  /* 4. Modifier / déplacer un rendez-vous --------------------------- */
  const [datePart, timePart] = startAt.split('T');
  const movedTime = `${String(Number(timePart.slice(0, 2)) + 1).padStart(2, '0')}:${timePart.slice(3)}`;
  const moved = await secretary('PATCH', `/api/appointments/${apptId}`, { start_at: `${datePart}T${movedTime}` });
  check('4. Déplacer un rendez-vous (drag & drop)', moved.status === 200 && moved.body.appointment.start_at === `${datePart}T${movedTime}`,
    `status=${moved.status}`);

  const edit = await secretary('PATCH', `/api/appointments/${apptId}`, {
    duration_min: 45, status: 'to_confirm', comment: 'modifié',
  });
  check('4. Modifier un rendez-vous (durée, statut, commentaire)', edit.status === 200 && edit.body.appointment.duration_min === 45,
    `status=${edit.status}`);

  /* 5. Annuler un rendez-vous -------------------------------------- */
  const cancel = await secretary('POST', `/api/appointments/${apptId}/status`, { status: 'cancelled' });
  check('5. Annuler un rendez-vous', cancel.status === 200 && cancel.body.appointment.status === 'cancelled');

  const slotFreed = await secretary('GET', `/api/appointments/meta/check?start_at=${datePart}T${movedTime}&practitioner_id=1&duration=45`);
  check('5. Le créneau annulé redevient libre', slotFreed.body.available === true, JSON.stringify(slotFreed.body));

  /* 8. Historique du patient --------------------------------------- */
  const history = await secretary('GET', `/api/patients/${patientId}`);
  check('8. Consulter l\'historique des rendez-vous', history.status === 200 && history.body.appointments.length === 1,
    `count=${history.body.appointments?.length}`);
  check('8. L\'historique indique le créneau, le praticien et le statut',
    !!history.body.appointments?.[0]?.start_at && !!history.body.appointments?.[0]?.practitioner_name);

  /* 9. Liste d'attente --------------------------------------------- */
  const waiting = await secretary('POST', '/api/waiting-list', {
    patient_id: patientId, full_name: 'Test Scénario', phone: '+212 600 00 00 01',
    appointment_type: 'Suivi', day_preference: 'mardi matin', comment: 'test',
  });
  check('9. Ajouter un patient à la liste d\'attente', waiting.status === 201, `status=${waiting.status}`);
  const waitingList = await secretary('GET', '/api/waiting-list?status=pending');
  check('9. La liste d\'attente affiche le patient', waitingList.body.entries.some((e) => e.id === waiting.body.entry?.id));

  /* 10. Permissions ------------------------------------------------- */
  const secUsers = await secretary('GET', '/api/admin/users');
  check('10. La télésecrétaire ne voit pas les utilisateurs (403)', secUsers.status === 403, `status=${secUsers.status}`);
  const secStats = await secretary('GET', '/api/stats?period=month');
  check('10. La télésecrétaire n\'a pas accès aux statistiques (403)', secStats.status === 403, `status=${secStats.status}`);
  const pracStats = await practitioner('GET', '/api/stats?period=month');
  check('10. L\'orthophoniste n\'a pas accès aux statistiques (403)', pracStats.status === 403, `status=${pracStats.status}`);

  const createUser = await admin('POST', '/api/admin/users', {
    name: 'Nouvelle Secrétaire', email: 'nouvelle@cabinet.ma', role: 'secretary', password: 'Motdepasse1',
  });
  check('10. Créer un utilisateur (télésecrétaire)', createUser.status === 201, `status=${createUser.status}`);

  const weakPassword = await admin('POST', '/api/admin/users', {
    name: 'Test', email: 'test@cabinet.ma', role: 'secretary', password: '123',
  });
  check('10. Mot de passe faible refusé', weakPassword.status === 400, `status=${weakPassword.status}`);

  // L'orthophoniste ne peut gérer que ses propres rendez-vous.
  const pracOther = await practitioner('POST', '/api/appointments', {
    patient_id: patientId, practitioner_id: 2, type_id: 2,
    start_at: '2030-01-08T10:00', duration_min: 30, status: 'confirmed',
  });
  check('10. Orthophoniste bloqué sur le praticien d\'un collègue (403)', pracOther.status === 403, `status=${pracOther.status}`);
  const pracOwn = await practitioner('POST', '/api/appointments', {
    patient_id: patientId, practitioner_id: 1, type_id: 2,
    start_at: '2030-01-08T10:00', duration_min: 30, status: 'confirmed',
  });
  check('10. Orthophoniste peut créer sur son propre agenda', pracOwn.status === 201, `status=${pracOwn.status}`);

  const pracNoDelete = await practitioner('DELETE', `/api/appointments/${apptId}`);
  check('10. Orthophoniste ne peut pas supprimer un rendez-vous (403)', pracNoDelete.status === 403, `status=${pracNoDelete.status}`);

  /* 6. Supprimer un rendez-vous ------------------------------------ */
  const del = await secretary('DELETE', `/api/appointments/${apptId}`);
  check('6. Supprimer un rendez-vous', del.status === 200, `status=${del.status}`);

  /* Agenda, disponibilités, statistiques, messages ------------------ */
  const agenda = await secretary('GET', '/api/appointments?from=2030-01-01&to=2030-01-31');
  check('Agenda : lecture de la plage', agenda.status === 200 && Array.isArray(agenda.body.appointments));

  const stats = await admin('GET', '/api/stats?period=month');
  check('Statistiques accessibles à l\'administrateur', stats.status === 200 && typeof stats.body.total === 'number',
    `status=${stats.status}`);
  check('Statistiques : taux de transformation présent', typeof stats.body.transformation_rate === 'number');

  const availability = await admin('PUT', `/api/practitioners/${loginPrac.body.user.practitioner_id}/availability`, {
    slots: [
      { weekday: 1, start_time: '09:00', end_time: '12:00', kind: 'work' },
      { weekday: 1, start_time: '12:00', end_time: '13:00', kind: 'break', label: 'Pause' },
      { weekday: 3, start_time: '14:00', end_time: '18:00', kind: 'work' },
    ],
  });
  check('Disponibilités hebdomadaires enregistrées', availability.status === 200 && availability.body.slots.length === 3,
    `status=${availability.status}`);

  const blocked = await admin('POST', '/api/blocked-times', {
    practitioner_id: 1, date: '2030-01-10', start_time: '09:00', end_time: '18:00', reason: 'conge', note: 'Congé test',
  });
  check('Congé enregistré', blocked.status === 201, `status=${blocked.status}`);
  const slotsOnLeave = await secretary('GET', '/api/appointments/meta/slots?date=2030-01-10&practitioner_id=1&duration=30');
  check('Un jour de congé ne propose aucun créneau libre',
    slotsOnLeave.body.slots.every((s) => s.status !== 'available'));

  const message = await secretary('POST', '/api/messages/render', {
    template_key: 'confirmation', appointment_id: 0, patient_id: 1, date: '2030-01-07', time: '09:30',
  });
  check('Message de confirmation généré', message.status === 200 && /07\/01\/2030/.test(message.body.body),
    message.body?.body);

  const activity = await admin('GET', '/api/admin/activity?limit=20');
  check('Journal des actions alimenté', activity.status === 200 && activity.body.logs.length > 0);
  check('Journal : format « action par qui — date/heure »',
    /par .+ — \d{2}\/\d{2}\/\d{4} à \d{2}:\d{2}/.test(activity.body.logs[0]?.summary || ''),
    activity.body.logs[0]?.summary);
} catch (err) {
  failed++;
  results.push(`  ✗ Erreur inattendue : ${err.message}`);
} finally {
  stop();
}

console.log('\nRésultats des scénarios demandés :\n');
console.log(results.join('\n'));
console.log(`\n${passed} réussi(s), ${failed} échec(s)\n`);
process.exit(failed ? 1 : 0);
