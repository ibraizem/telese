/** Écran de connexion. */
import { useState } from 'react';
import { useSession } from '../session';
import { Button, Field, Input } from '../ui';

const DEMO = [
  ['Administrateur', 'sophie@cabinet.ma'],
  ['Télésecrétaire', 'imane@cabinet.ma'],
  ['Orthophoniste', 'nadia@cabinet.ma'],
];

export default function Login() {
  const { login } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message || 'Connexion impossible.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <aside className="login-aside">
        <div className="row">
          <span className="sidebar__logo">OR</span>
          <strong style={{ fontSize: 17 }}>Cabinet d'orthophonie</strong>
        </div>
        <h1>Devlink secrétariat<br />du cabinet</h1>
        <p style={{ color: '#cfd9f2', maxWidth: 460 }}>
          Un outil interne simple et rapide pour prendre, confirmer et suivre
          les rendez-vous du cabinet — agenda partagé, patients, liste d'attente.
        </p>
        <ul>
          <li>Prise de rendez-vous en moins d'une minute</li>
          <li>Agenda partagé : jour, semaine, mois, glisser-déposer</li>
          <li>Aucune double réservation possible</li>
          <li>Journal de toutes les actions du cabinet</li>
        </ul>
        <p style={{ fontSize: 12.5, color: '#9fb0d6' }}>
          Outil de gestion interne — n'est pas un dossier médical électronique.
        </p>
      </aside>

      <div className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <h2>Connexion</h2>
          <p className="muted small" style={{ marginBottom: 18 }}>
            Accès réservé à l'équipe du cabinet.
          </p>

          {error && (
            <div className="toast toast--error" style={{ position: 'static', marginBottom: 14, cursor: 'default' }}>
              {error}
            </div>
          )}

          <div className="stack">
            <Field label="Adresse e-mail" required>
              <Input
                type="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="prenom@cabinet.ma"
                autoComplete="username"
              />
            </Field>
            <Field label="Mot de passe" required>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </Field>
            <Button type="submit" variant="primary" size="lg" disabled={loading}>
              {loading ? 'Connexion…' : 'Se connecter'}
            </Button>
          </div>

          <div className="login-demo">
            Données de démonstration (mot de passe <strong>Demo1234</strong>) :
            {DEMO.map(([label, mail]) => (
              <button
                key={mail}
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => { setEmail(mail); setPassword('Demo1234'); }}
              >
                {label} — {mail}
              </button>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}
