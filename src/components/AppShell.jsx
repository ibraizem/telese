/**
 * Coquille de l'application : barre latérale de navigation, barre
 * supérieure avec les actions principales, gestion du menu mobile.
 */
import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../session';
import { Button, cx } from '../ui';
import { formatDateFr, formatLongDate, todayISO } from '../date';

const NAV = [
  { to: '/dashboard', label: 'Tableau de bord', icon: '▤', perm: 'dashboard.view' },
  { to: '/agenda', label: 'Agenda', icon: '▦', perm: 'agenda.view' },
  { to: '/patients', label: 'Patients', icon: '☺', perm: 'patients.view' },
  { to: '/waiting', label: 'Liste d\'attente', icon: '⏰', perm: 'waiting.view' },
  { to: '/practitioners', label: 'Orthophonistes', icon: '✚', perm: 'practitioners.view', roles: ['admin', 'secretary', 'practitioner'] },
  { to: '/stats', label: 'Statistiques', icon: '▥', perm: 'stats.view' },
  { to: '/settings', label: 'Paramètres', icon: '⚙', perm: 'users.manage' },
];

const TITLES = [
  ['/agenda', 'Agenda'],
  ['/patients', 'Patients'],
  ['/waiting', 'Liste d\'attente'],
  ['/practitioners', 'Orthophonistes'],
  ['/stats', 'Statistiques'],
  ['/settings', 'Paramètres'],
];

export default function AppShell({ children, onNewAppointment, onNewPatient }) {
  const { user, clinic, has, logout } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [location.pathname]);

  const title = TITLES.find(([p]) => location.pathname.startsWith(p))?.[1] || 'Tableau de bord';
  const initials = (user?.name || '?')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const items = NAV.filter((item) => {
    if (item.roles && !item.roles.includes(user?.role)) return false;
    if (item.perm === 'practitioners.view' && user?.role === 'practitioner') return true;
    return has(item.perm);
  });

  const canBook = has('agenda.write');
  const canCreatePatient = has('patients.write');

  return (
    <div className="app">
      <aside className={cx('sidebar', open && 'sidebar--open')}>
        <div className="sidebar__brand">
          <span className="sidebar__logo">OR</span>
          <div>
            <div className="sidebar__name">{clinic?.name || 'Cabinet'}</div>
            <div className="sidebar__tagline">Devlink secrétariat</div>
          </div>
        </div>

        <div className="sidebar__section">Navigation</div>
        <nav className="nav">
          {items.map((item) => {
            const label =
              item.to === '/practitioners' && user?.role === 'practitioner'
                ? 'Mes disponibilités'
                : item.label;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => cx('nav__item', isActive && 'nav__item--active')}
              >
                <span className="nav__icon" aria-hidden="true">{item.icon}</span>
                <span>{label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar__footer">
          <div className="sidebar__user">
            <span className="avatar">{initials}</span>
            <div>
              <div className="sidebar__user-name">{user?.name}</div>
              <div className="sidebar__user-role">
                {user?.role === 'admin' ? 'Administrateur' : user?.role === 'secretary' ? 'Télésecrétaire' : 'Orthophoniste'}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="btn--block" onClick={() => logout()} style={{ color: '#9fb0cc' }}>
            Se déconnecter
          </Button>
        </div>
      </aside>

      {open && <div className="modal-overlay" style={{ zIndex: 25 }} onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn sidebar-toggle"
            aria-label="Ouvrir le menu"
            onClick={() => setOpen((v) => !v)}
          >
            ☰
          </button>
          <span className="topbar__title">{title}</span>
          <span className="topbar__date">{formatDateFr(todayISO())} · {formatLongDate(todayISO())}</span>
          <span className="topbar__spacer" />

          <Button variant="ghost" size="sm" onClick={() => navigate('/agenda?today=1')}>
            Voir aujourd'hui
          </Button>
          {canCreatePatient && (
            <Button variant="secondary" size="sm" icon="+" onClick={() => onNewPatient?.()}>
              Nouveau patient
            </Button>
          )}
          {canBook && (
            <Button variant="primary" size="sm" icon="+" onClick={() => onNewAppointment?.()}>
              Nouveau RDV
            </Button>
          )}
        </header>

        <main className="content">{children}</main>
      </div>
    </div>
  );
}
