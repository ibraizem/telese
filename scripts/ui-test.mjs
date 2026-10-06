/**
 * Tests de bout en bout de l'interface (Chrome headless).
 *
 * Usage : npm run test:ui
 *
 * Le script crée une base jetée, compile le frontend (vite build), lance
 * l'application de production sur le port 4124, exécute les parcours clés
 * puis arrête tout. Aucune donnée de travail n'est touchée.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const DB_PATH = path.join(root, 'data', 'ui-test.db');
const PORT = 4124;
const BASE = `http://localhost:${PORT}`;
const env = { ...process.env, DB_PATH, PORT: String(PORT), NODE_ENV: 'test' };

let passed = 0;
let failed = 0;
const results = [];
const check = (label, ok, detail = '') => {
  if (ok) { passed++; results.push(`  ✓ ${label}`); }
  else { failed++; results.push(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
};

async function waitFor(url, timeout = 40000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const clickText = (page, text, selector = 'button, a, .list-row, .nav__item') =>
  page.evaluate((needle, sel) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.replace(/\s+/g, ' ').includes(needle));
    if (!el) return false;
    el.click();
    return true;
  }, text, selector);

const textOf = (page, selector) =>
  page.evaluate((sel) => document.querySelector(sel)?.textContent.replace(/\s+/g, ' ').trim() || '', selector);

async function login(page, email) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 20000 });
  await page.click('input[type="email"]');
  await page.type('input[type="email"]', email, { delay: 5 });
  await page.click('input[type="password"]');
  await page.type('input[type="password"]', 'Demo1234', { delay: 5 });
  await Promise.all([
    page.waitForSelector('.app', { timeout: 20000 }),
    clickText(page, 'Se connecter'),
  ]);
}

async function goto(page, route, waitForSelector) {
  await page.evaluate((r) => window.history.pushState({}, '', r), route);
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (waitForSelector) await page.waitForSelector(waitForSelector, { timeout: 20000 });
}

/* ------------------------------------------------------------------ */
/* Préparation : seed + build + serveur de production                   */
/* ------------------------------------------------------------------ */
for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) fs.rmSync(f, { force: true });

const seed = spawnSync('node', [path.join(root, 'server', 'seed.js'), '--fresh'], { env, stdio: 'pipe' });
if (seed.status !== 0) {
  console.error('Échec du seed :', seed.stderr?.toString());
  process.exit(1);
}

const build = spawnSync('npx', ['vite', 'build'], { cwd: root, stdio: 'pipe' });
if (build.status !== 0) {
  console.error('Échec de la compilation :', build.stdout?.toString(), build.stderr?.toString());
  process.exit(1);
}

const server = spawn('node', [path.join(root, 'server', 'index.js')], { env, stdio: 'ignore' });
const stop = () => { try { server.kill('SIGTERM'); } catch { /* déjà arrêté */ } };
process.on('exit', stop);

const consoleErrors = [];
let browser;

try {
  if (!(await waitFor(`${BASE}/api/health`))) throw new Error('Le serveur de test n\'a pas démarré.');

  browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.url().includes('/api/') && res.status() >= 500) consoleErrors.push(`HTTP ${res.status()} ${res.url()}`);
  });

  /* 1. Connexion télésecrétaire + tableau de bord ------------------ */
  await login(page, 'imane@cabinet.ma');
  check('Interface : connexion et tableau de bord', (await page.$('.app')) !== null);
  check('Tableau de bord : compteurs affichés', (await page.$$('.stat')).length >= 4);
  check("Tableau de bord : intitulé « Rendez-vous aujourd'hui »",
    (await textOf(page, '.content')).includes("Rendez-vous aujourd'hui"));

  /* 2. Prise de rendez-vous en quelques clics ----------------------- */
  await clickText(page, 'Nouveau RDV');
  await page.waitForSelector('.modal', { timeout: 15000 });
  // Le jour courant peut être incomplet : on se place sur le prochain lundi.
  const monday = await page.evaluate(() => {
    const d = new Date();
    const delta = ((8 - d.getDay()) % 7) || 7;
    d.setDate(d.getDate() + delta);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
  await page.evaluate((value) => {
    const input = document.querySelector('.modal input[type="date"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, monday);
  await page.waitForSelector('.modal .slots', { timeout: 15000 });
  check('Formulaire RDV : créneaux affichés', (await page.$$('.modal .slots .slot')).length > 3);
  check('Formulaire RDV : créneaux occupés/fermés grisés',
    (await page.$$eval('.modal .slots .slot', (els) => els.filter((e) => e.disabled).length)) > 0);
  await page.click('.modal .slots .slot:not([disabled])');

  await page.click('.modal .search-input input');
  await page.type('.modal .search-input input', 'bennani', { delay: 15 });
  await page.waitForSelector('.modal .patient-result', { timeout: 15000 });
  check('Formulaire RDV : recherche de patient', (await page.$$('.modal .patient-result')).length > 0);
  await page.click('.modal .patient-result');

  await clickText(page, 'Confirmer le rendez-vous', '.modal button');
  await new Promise((r) => setTimeout(r, 1500));
  const modalStillOpen = (await page.$('.modal')) !== null;
  const errorShown = modalStillOpen ? await textOf(page, '.modal .toast--error') : '';
  check('Formulaire RDV : enregistrement', !modalStillOpen, errorShown || 'la fenêtre est restée ouverte');

  /* 3. Agenda : vues jour / semaine / mois -------------------------- */
  await goto(page, '/agenda', '.agenda-grid');
  check('Agenda : rendez-vous affichés', (await page.$$('.appt')).length > 0);
  await clickText(page, 'Mois', '.segmented button');
  await page.waitForSelector('.month-grid', { timeout: 10000 });
  check('Agenda : vue mois', (await page.$$('.month-cell')).length >= 28);
  await clickText(page, 'Jour', '.segmented button');
  await page.waitForSelector('.agenda-day', { timeout: 10000 });
  check('Agenda : vue jour', (await page.$$('.agenda-day')).length === 1);
  await clickText(page, 'Semaine', '.segmented button');
  await page.waitForSelector('.agenda-day', { timeout: 10000 });
  check('Agenda : vue semaine', (await page.$$('.agenda-day')).length === 7);

  /* 4. Patients : recherche, fiche, historique ----------------------- */
  await goto(page, '/patients', '.split');
  await page.click('.search-input input');
  await page.type('.search-input input', 'salma', { delay: 15 });
  await page.waitForSelector('.list-row', { timeout: 15000 });
  await page.click('.list-row');
  await page.waitForSelector('.kv', { timeout: 15000 });
  check('Patients : fiche ouverte', (await textOf(page, '.patient-header__name')).includes('Salma'));
  check("Patients : historique des rendez-vous affiché",
    (await page.$$eval('.table tbody tr', (rows) => rows.length).catch(() => 0)) > 0);

  /* 5. Liste d'attente ---------------------------------------------- */
  await goto(page, '/waiting', '.table');
  check("Liste d'attente : patients inscrits", (await page.$$('.table tbody tr')).length > 0);

  /* 6. Disponibilités ------------------------------------------------ */
  await goto(page, '/practitioners', '.availability-row');
  check('Disponibilités : 7 jours affichés', (await page.$$('.availability-row')).length === 7);

  /* 7. Rôles : la télésecrétaire n'a pas accès aux pages admin ------- */
  await goto(page, '/stats');
  check('Rôle télésecrétaire : statistiques refusées', (await textOf(page, '.content')).includes('Accès réservé'));
  await goto(page, '/settings');
  check('Rôle télésecrétaire : paramètres refusés', (await textOf(page, '.content')).includes('Accès réservé'));

  /* 8. Administrateur : statistiques, utilisateurs, journal ---------- */
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
  await new Promise((r) => setTimeout(r, 500));
  await login(page, 'sophie@cabinet.ma');

  await goto(page, '/stats', '.stat');
  check('Statistiques : indicateurs affichés', (await page.$$('.stat')).length >= 6);
  check('Statistiques : taux de transformation présent',
    (await textOf(page, '.content')).includes('transformation'));

  await goto(page, '/settings', '.table');
  check('Paramètres : comptes utilisateurs listés', (await page.$$('.table tbody tr')).length >= 5);

  /* 9. Création d'un patient depuis l'interface ---------------------- */
  await goto(page, '/patients');
  await clickText(page, 'Nouveau patient');
  await page.waitForSelector('.modal', { timeout: 10000 });
  const inputs = await page.$$('.modal input');
  await inputs[0].type('Zineb', { delay: 5 });
  await inputs[1].type('Test E2E', { delay: 5 });
  await inputs[2].type('+212 699 00 11 22', { delay: 5 });
  await clickText(page, 'Créer le patient', '.modal button');
  await new Promise((r) => setTimeout(r, 1500));
  check("Patients : création depuis l'interface", (await page.$('.modal')) === null);

  /* 10. Aucune erreur JavaScript ------------------------------------- */
  const realErrors = consoleErrors.filter(
    (e) => !/favicon|Download the React DevTools|React Router Future Flag|Failed to load resource/i.test(e)
  );
  check('Aucune erreur JavaScript dans le navigateur', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
} catch (err) {
  failed++;
  results.push(`  ✗ Erreur inattendue : ${err.message}`);
  if (browser) {
    try {
      const page = (await browser.pages())[0];
      const diag = await page?.evaluate(() => ({
        url: location.href,
        hasApp: !!document.querySelector('.app'),
        text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300),
      }));
      results.push(`    diagnostic: ${JSON.stringify(diag)}`);
    } catch { /* page indisponible */ }
  }
  if (consoleErrors.length) results.push(`    console: ${consoleErrors.slice(0, 4).join(' | ')}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  stop();
}

console.log('\nParcours de bout en bout (interface) :\n');
console.log(results.join('\n'));
console.log(`\n${passed} réussi(s), ${failed} échec(s)\n`);
process.exit(failed ? 1 : 0);
