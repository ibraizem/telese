/**
 * Données de démonstration (100 % fictives) pour tester l'application.
 *
 * Usage :
 *   npm run seed          -- recrée les données si la base est vide
 *   npm run seed:fresh    -- efface tout et recrée les données
 *
 * Comptes de démonstration (mot de passe commun : Demo1234)
 *   sophie@cabinet.ma      Administrateur
 *   imane@cabinet.ma       Télésecrétaire
 *   nadia@cabinet.ma       Orthophoniste
 *   youssef@cabinet.ma     Orthophoniste
 *   lina@cabinet.ma        Orthophoniste
 */
import db from './db.js';
import { hashPassword } from './auth.js';
import { ensureDefaultTemplates } from './routes/messages.js';
import { buildDaySlots } from './scheduling.js';

const FRESH = process.argv.includes('--fresh');
const PASSWORD = 'Demo1234';
const p2 = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const today = new Date();
const addDays = (n) => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return iso(d);
};

if (!FRESH && (await db.prepare('SELECT COUNT(*) AS n FROM appointments').get()).n > 0) {
  console.log('La base contient déjà des données. Utilisez « npm run seed:fresh » pour tout recréer.');
  process.exit(0);
}

// --- Remise à zéro (les clés étrangères suppriment tout en cascade) -----
await db.exec('DELETE FROM clinics');
await db.exec('DELETE FROM sqlite_sequence').catch(() => {});

let clinicId;
async function insertClinic() {
  const info = await db
    .prepare(
      `INSERT INTO clinics (name, phone, address, city, timezone, day_start, day_end, slot_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      'Cabinet Les Hirondelles — Orthophonie',
      '+212 5 22 47 18 09',
      '12, rue Al Massira',
      'Casablanca',
      'Africa/Casablanca',
      '09:00',
      '18:00',
      30
    );
  clinicId = info.lastInsertRowid;
  await ensureDefaultTemplates(clinicId);
}

/* -------------------------------------------------------------------- */
/* Types de rendez-vous                                                  */
/* -------------------------------------------------------------------- */
const TYPES = [
  { name: 'Première consultation', duration: 45, color: '#4f6bed' },
  { name: 'Suivi', duration: 30, color: '#0e9f6e' },
  { name: 'Bilan', duration: 60, color: '#d97706' },
  { name: 'Rééducation', duration: 30, color: '#7c3aed' },
  { name: 'Atelier parents', duration: 45, color: '#0891b2' },
];
const typeIds = {};
async function insertTypes() {
  const ins = db.prepare(
    'INSERT INTO appointment_types (clinic_id, name, duration_min, color, sort_order) VALUES (?, ?, ?, ?, ?)'
  );
  for (let i = 0; i < TYPES.length; i++) {
    const t = TYPES[i];
    const r = await ins.run(clinicId, t.name, t.duration, t.color, i);
    typeIds[t.name] = r.lastInsertRowid;
  }
}

/* -------------------------------------------------------------------- */
/* Orthophonistes                                                        */
/* -------------------------------------------------------------------- */
const PRACTITIONERS = [
  { first: 'Nadia', last: 'Berrada', email: 'nadia@cabinet.ma', phone: '+212 661 20 14 88', color: '#4f6bed' },
  { first: 'Youssef', last: 'Alaoui', email: 'youssef@cabinet.ma', phone: '+212 662 33 71 04', color: '#0e9f6e' },
  { first: 'Lina', last: 'Tazi', email: 'lina@cabinet.ma', phone: '+212 663 84 55 12', color: '#d97706' },
];
const pracIds = {};
async function insertPractitioners() {
  const ins = db.prepare(
    `INSERT INTO practitioners (clinic_id, first_name, last_name, email, phone, color, active, can_edit_own_availability)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1)`
  );
  for (const p of PRACTITIONERS) {
    const r = await ins.run(clinicId, p.first, p.last, p.email, p.phone, p.color);
    pracIds[p.first] = r.lastInsertRowid;
  }
}

/* -------------------------------------------------------------------- */
/* Utilisateurs                                                          */
/* -------------------------------------------------------------------- */
async function insertUsers() {
  const ins = db.prepare(
    `INSERT INTO users (clinic_id, name, email, password_hash, role, practitioner_id, active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  );
  const hash = hashPassword(PASSWORD);
  await ins.run(clinicId, 'Sophie Marchand', 'sophie@cabinet.ma', hash, 'admin', null);
  await ins.run(clinicId, 'Imane Chraïbi', 'imane@cabinet.ma', hash, 'secretary', null);
  for (const p of PRACTITIONERS) {
    await ins.run(clinicId, `${p.first} ${p.last}`, p.email, hash, 'practitioner', pracIds[p.first]);
  }
}

/* -------------------------------------------------------------------- */
/* Disponibilités hebdomadaires (1 = lundi ... 7 = dimanche)              */
/* -------------------------------------------------------------------- */
async function insertAvailability() {
  const ins = db.prepare(
    `INSERT OR IGNORE INTO availability (clinic_id, practitioner_id, weekday, start_time, end_time, kind, label)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const add = (prac, weekday, start, end, kind = 'work', label = '') =>
    ins.run(clinicId, prac, weekday, start, end, kind, label);

  // Nadia : exemple du cahier des charges
  for (const [w, s, e] of [[1, '09:00', '18:00'], [2, '09:00', '18:00'], [3, '09:00', '13:00'], [4, '09:00', '18:00'], [5, '09:00', '17:00']]) {
    await add(pracIds.Nadia, w, s, e);
  }
  for (const w of [1, 2, 4, 5]) await add(pracIds.Nadia, w, '13:00', '14:00', 'break', 'Pause déjeuner');

  // Youssef
  for (const [w, s, e] of [[1, '09:00', '18:00'], [2, '09:00', '18:00'], [3, '13:00', '18:00'], [4, '09:00', '18:00'], [5, '09:00', '17:00']]) {
    await add(pracIds.Youssef, w, s, e);
  }
  await add(pracIds.Youssef, 2, '12:30', '13:30', 'break', 'Pause');

  // Lina
  for (const [w, s, e] of [[1, '10:00', '18:00'], [2, '10:00', '18:00'], [3, '10:00', '18:00'], [4, '10:00', '18:00'], [5, '10:00', '17:00'], [6, '09:00', '13:00']]) {
    await add(pracIds.Lina, w, s, e);
  }
  for (const w of [1, 2, 3, 4, 5]) await add(pracIds.Lina, w, '12:30', '13:30', 'break', 'Pause déjeuner');
}

async function insertBlockedTimes() {
  const ins = db.prepare(
    `INSERT INTO blocked_times (clinic_id, practitioner_id, date, start_time, end_time, reason, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  );
  await ins.run(clinicId, pracIds.Nadia, addDays(12), '09:00', '18:00', 'conge', 'Congé annuel');
  await ins.run(clinicId, pracIds.Youssef, addDays(5), '09:00', '12:00', 'indispo', 'Formation');
  await ins.run(clinicId, null, addDays(8), '12:00', '14:00', 'exception', 'Pause exceptionnelle du cabinet');
}

/* -------------------------------------------------------------------- */
/* Patients (20, fictifs)                                                */
/* -------------------------------------------------------------------- */
const PATIENTS = [
  ['Amine', 'El Amrani', '+212 661 12 34 56', '2015-04-12', 'Karim El Amrani', '+212 661 98 76 54'],
  ['Salma', 'Bennani', '+212 662 23 45 67', '2012-09-03', 'Fatima Bennani', '+212 662 87 65 43'],
  ['Yassine', 'Chraïbi', '+212 663 34 56 78', '2010-01-22', '', ''],
  ['Meryem', 'Idrissi', '+212 664 45 67 89', '2016-07-30', 'Samira Idrissi', '+212 664 76 54 32'],
  ['Omar', 'Fassi', '+212 665 56 78 90', '2018-11-05', 'Rachid Fassi', '+212 665 65 43 21'],
  ['Hajar', 'Tazi', '+212 666 67 89 01', '2013-03-17', '', ''],
  ['Zakaria', 'Naciri', '+212 667 78 90 12', '2011-06-25', 'Hind Naciri', '+212 667 54 32 10'],
  ['Loubna', 'Bouazza', '+212 668 89 01 23', '2017-02-14', 'Anass Bouazza', '+212 668 43 21 09'],
  ['Anas', 'Sekkat', '+212 669 90 12 34', '2009-08-08', '', ''],
  ['Nouhaila', 'Lamrani', '+212 661 01 23 45', '2015-12-01', 'Youssef Lamrani', '+212 661 32 10 98'],
  ['Ayoub', 'Berrada', '+212 662 12 34 56', '2014-05-19', 'Meriem Berrada', '+212 662 21 09 87'],
  ['Rania', 'Ouazzani', '+212 663 23 45 67', '2016-10-27', '', ''],
  ['Ilyas', 'Sabri', '+212 664 34 56 78', '2012-04-09', 'Nadia Sabri', '+212 664 10 98 76'],
  ['Aya', 'Moutaouakil', '+212 665 45 67 89', '2019-01-15', 'Hicham Moutaouakil', '+212 665 09 87 65'],
  ['Badr', 'Kettani', '+212 666 56 78 90', '2010-11-11', '', ''],
  ['Safaa', 'Rahmani', '+212 667 67 89 01', '2013-07-07', 'Iman Rahmani', '+212 667 98 76 54'],
  ['Mehdi', 'Zerhouni', '+212 668 78 90 12', '2011-02-28', '', ''],
  ['Kenza', 'Alaoui', '+212 669 89 01 23', '2017-09-21', 'Moha Alaoui', '+212 669 87 65 43'],
  ['Reda', 'Hakimi', '+212 661 90 12 34', '2008-12-30', 'Samira Hakimi', '+212 661 76 54 32'],
  ['Soukaina', 'Boukhris', '+212 662 01 23 45', '2015-06-06', '', ''],
];
const patientIds = [];
async function insertPatients() {
  const ins = db.prepare(
    `INSERT INTO patients (clinic_id, first_name, last_name, phone, whatsapp, email, birth_date,
                           guardian_name, guardian_phone, admin_comment, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime', ?))`
  );
  for (let i = 0; i < PATIENTS.length; i++) {
    const [first, last, phone, birth, guardian, guardianPhone] = PATIENTS[i];
    const daysAgo = 60 - i * 2; // ancienneté échelonnée
    const r = await ins.run(
      clinicId, first, last, phone, phone,
      `${first.toLowerCase()}.${last.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}@example.ma`,
      birth, guardian, guardianPhone,
      i % 4 === 0 ? 'Préfère être appelé en fin de journée.' : '',
      2, `${-daysAgo} days`
    );
    patientIds.push(r.lastInsertRowid);
  }
}

/* -------------------------------------------------------------------- */
/* Rendez-vous (30+, répartis autour d'aujourd'hui)                       */
/* -------------------------------------------------------------------- */
const usedKey = new Map();
function used(pracId, dateStr) {
  const k = `${pracId}|${dateStr}`;
  if (!usedKey.has(k)) usedKey.set(k, []);
  return usedKey.get(k);
}

/** Choisit des créneaux libres pour un praticien à une date. */
async function pickSlots(pracId, dateStr, wanted, durations) {
  const clinic = await db.prepare('SELECT * FROM clinics WHERE id = ?').get(clinicId);
  const taken = used(pracId, dateStr);
  const out = [];
  for (const dur of durations) {
    if (out.length >= wanted) break;
    for (const s of await buildDaySlots({ clinic, dateStr, practitionerId: pracId, durationMin: dur })) {
      if (out.length >= wanted) break;
      if (s.status !== 'available') continue;
      const start = Number(s.start.slice(0, 2)) * 60 + Number(s.start.slice(3, 5));
      const end = start + dur;
      if (taken.some((u) => start < u.end && u.start < end)) continue;
      taken.push({ start, end });
      out.push({ start: s.start, duration: dur });
    }
  }
  return out;
}

async function insertAppointments() {
  const ins = db.prepare(
    `INSERT INTO appointments (clinic_id, patient_id, practitioner_id, type_id, start_at, duration_min,
                               status, initial_status, comment, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime', ?))`
  );

  const comments = [
    'Mère du patient appellera pour confirmer.',
    'Patient préfère les créneaux du matin.',
    'À placer après l\'école.',
    '',
    '',
    'Rappel envoyé par SMS.',
    '',
  ];
  const pracKeys = Object.keys(pracIds);
  let made = 0;
  let patientCursor = 0;

  // Répartition : 30 rendez-vous autour d'aujourd'hui (passé + futur)
  const offsets = [];
  for (let d = -21; d <= 21; d++) offsets.push(d);

  let index = 0;
  for (const offset of offsets) {
    const dateStr = addDays(offset);
    const weekday = new Date(`${dateStr}T12:00:00`).getDay();
    if (weekday === 0) continue; // dimanche fermé

    const perDay = offset === 0 ? 6 : offset > 0 && offset < 7 ? 3 : 2;
    for (const key of pracKeys) {
      const pracId = pracIds[key];
      const durations = ['Première consultation', 'Suivi', 'Bilan', 'Rééducation'].map((n) => typeIds[n]);
      const slots = await pickSlots(pracId, dateStr, key === 'Nadia' ? perDay : Math.max(1, perDay - 1), durations);
      for (const slot of slots) {
        if (made >= 40) break;
        const patientId = patientIds[patientCursor % patientIds.length];
        patientCursor++;
        const typeEntry = TYPES[index % 4];
        const typeId = typeIds[typeEntry.name];

        // Statut cohérent avec la date
        let status;
        if (offset < 0) {
          const roll = index % 10;
          status = roll < 6 ? 'done' : roll < 7 ? 'absent' : roll < 9 ? 'cancelled' : 'postponed';
        } else if (offset === 0) {
          const roll = index % 6;
          status = roll < 4 ? 'confirmed' : roll === 4 ? 'confirmed' : 'to_confirm';
        } else {
          const roll = index % 8;
          status = roll < 5 ? 'confirmed' : roll < 6 ? 'request' : roll < 7 ? 'to_confirm' : 'cancelled';
        }
        const initial = index % 7 === 3 && offset >= 0 ? 'request' : status;

        await ins.run(
          clinicId,
          patientId,
          pracId,
          typeId,
          `${dateStr}T${slot.start}`,
          slot.duration,
          status,
          initial,
          comments[index % comments.length],
          2,
          `${-(index % 45)} days`
        );
        made++;
        index++;
      }
      if (made >= 40) break;
    }
    if (made >= 40) break;
  }
  return made;
}

/* -------------------------------------------------------------------- */
/* Liste d'attente                                                       */
/* -------------------------------------------------------------------- */
async function insertWaitingList() {
  const ins = db.prepare(
    `INSERT INTO waiting_list (clinic_id, patient_id, full_name, phone, appointment_type,
                               desired_date, day_preference, comment, status, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime', ?))`
  );
  const entries = [
    [patientIds[3], 'Meryem Idrissi', '+212 664 45 67 89', 'Suivi', addDays(3), 'Mardi ou jeudi, après 16h', 'Attend un créneau en fin de journée.', 'pending', -600],
    [null, 'Hicham Bakri', '+212 668 11 22 33', 'Première consultation', '', 'Lundi matin', 'Souhaite un premier rendez-vous rapidement.', 'pending', -2880],
    [patientIds[11], 'Rania Ouazzani', '+212 663 23 45 67', 'Bilan', addDays(6), 'Mercredi', 'Bilan de fin d\'année scolaire.', 'contacted', -4320],
    [null, 'Zineb Filali', '+212 669 44 55 66', 'Rééducation', '', 'N\'importe quel jour sauf vendredi', '', 'pending', -1440],
    [patientIds[18], 'Reda Hakimi', '+212 661 90 12 34', 'Suivi', addDays(2), 'Jeudi après-midi', 'Créneau déjà proposé, en attente de réponse.', 'scheduled', -720],
  ];
  for (const [pid, name, phone, type, date, pref, comment, status, minutesAgo] of entries) {
    await ins.run(clinicId, pid, name, phone, type, date, pref, comment, status, 2, `${Math.round(minutesAgo / 1440)} days`);
  }
}

/* -------------------------------------------------------------------- */
/* Journal + messages de démonstration                                   */
/* -------------------------------------------------------------------- */
async function insertLogs() {
  const log = (action, type, id, summary) =>
    db
      .prepare(
        `INSERT INTO activity_logs (clinic_id, user_id, user_name, action, entity_type, entity_id, summary)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(clinicId, null, '', action, type, id, summary);

  const clinicName = (await db.prepare('SELECT name FROM clinics WHERE id = ?').get(clinicId)).name;
  await log('clinic.created', 'clinic', clinicId, `Cabinet « ${clinicName} » créé`);
  await log('seed.imported', 'system', null, `Données de démonstration importées (3 orthophonistes, 20 patients, 40 rendez-vous)`);
}

/* -------------------------------------------------------------------- */
/* Exécution                                                             */
/* -------------------------------------------------------------------- */
await insertClinic();
await insertTypes();
await insertPractitioners();
await insertUsers();
await insertAvailability();
await insertBlockedTimes();
await insertPatients();
const apptCount = await insertAppointments();
await insertWaitingList();
await insertLogs();

const count = async (sql) => (await db.prepare(sql).get()).n;
console.log('\n✓ Données de démonstration créées (100 % fictives)');
console.log(`  Cabinet      : ${(await db.prepare('SELECT name FROM clinics WHERE id = ?').get(clinicId)).name}`);
console.log(`  Orthophonistes: ${await count('SELECT COUNT(*) AS n FROM practitioners')}`);
console.log(`  Patients      : ${await count('SELECT COUNT(*) AS n FROM patients')}`);
console.log(`  Rendez-vous   : ${apptCount}`);
console.log(`  Disponibilités: ${await count('SELECT COUNT(*) AS n FROM availability')} lignes, ${await count('SELECT COUNT(*) AS n FROM blocked_times')} indisponibilités`);
console.log(`  Liste d'attente: ${await count('SELECT COUNT(*) AS n FROM waiting_list')} entrées`);
console.log(`  Utilisateurs  : ${await count('SELECT COUNT(*) AS n FROM users')}`);
console.log('\nComptes de démonstration (mot de passe : Demo1234)');
console.log('  Administrateur   : sophie@cabinet.ma');
console.log('  Télésecrétaire   : imane@cabinet.ma');
console.log('  Orthophonistes   : nadia@cabinet.ma, youssef@cabinet.ma, lina@cabinet.ma\n');
