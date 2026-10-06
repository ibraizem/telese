/**
 * Tableau de bord : les rendez-vous du jour, les prochains rendez-vous
 * et les compteurs utiles au premier coup d'œil.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../session';
import { useModals } from '../modals';
import { Button, Card, Empty, PageHeader, Spinner, StatCard, StatusBadge, cx } from '../ui';
import { addDays, formatDateFr, formatLongDate, todayISO } from '../date';

const timeOf = (s) => s.slice(11, 16);

export default function Dashboard() {
  const { user, has } = useSession();
  const { openAppointment, openMessage, openPatient } = useModals();
  const navigate = useNavigate();

  const [today, setToday] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [waiting, setWaiting] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const day = todayISO();
    try {
      const [t, u, w] = await Promise.all([
        api.get(`/api/appointments?from=${day}&to=${day}`),
        api.get(`/api/appointments?from=${day}&to=${addDays(day, 14)}`),
        api.get('/api/waiting-list?status=pending').catch(() => ({ entries: [] })),
      ]);
      setToday(t.appointments);
      setUpcoming(u.appointments.filter((a) => a.date !== day));
      setWaiting(w.entries?.length || 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const count = (status) => today.filter((a) => a.status === status).length;
  const requests = upcoming.filter((a) => a.status === 'request').length + count('request');
  const cancelled = count('cancelled');
  const confirmed = count('confirmed');

  const next = upcoming
    .filter((a) => a.status !== 'cancelled')
    .slice(0, 10);

  return (
    <>
      <PageHeader
        title={`Bonjour ${user?.name?.split(' ')[0]}`}
        subtitle={formatLongDate(todayISO())}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/agenda?today=1')}>Voir aujourd'hui</Button>
            {has('patients.write') && <Button variant="secondary" icon="+" onClick={() => openPatient()}>Nouveau patient</Button>}
            {has('agenda.write') && <Button variant="primary" icon="+" onClick={() => openAppointment({})}>Nouveau rendez-vous</Button>}
          </>
        }
      />

      <div className="grid grid--stats" style={{ marginBottom: 16 }}>
        <StatCard
          label="Rendez-vous aujourd'hui"
          value={loading ? '…' : today.length}
          tone="primary"
          icon="▦"
          hint={formatDateFr(todayISO())}
          onClick={() => navigate('/agenda?today=1')}
        />
        <StatCard label="Confirmés" value={loading ? '…' : confirmed} tone="success" icon="✓" />
        <StatCard label="Annulés (aujourd'hui)" value={loading ? '…' : cancelled} tone="danger" icon="×" />
        <StatCard
          label="Nouvelles demandes"
          value={loading ? '…' : requests}
          tone="warning"
          icon="◷"
          hint="à confirmer"
          onClick={() => navigate('/agenda')}
        />
        <StatCard
          label="Liste d'attente"
          value={loading ? '…' : waiting}
          tone="info"
          icon="⏰"
          hint="patients en attente"
          onClick={has('waiting.view') ? () => navigate('/waiting') : undefined}
        />
      </div>

      <div className="dashboard-grid">
        <Card
          title={`Rendez-vous du jour — ${formatDateFr(todayISO())}`}
          action={<Button size="sm" variant="ghost" onClick={() => navigate('/agenda?today=1')}>Ouvrir l'agenda →</Button>}
          padded={false}
        >
          {loading ? (
            <Spinner />
          ) : today.length === 0 ? (
            <Empty
              title="Aucun rendez-vous aujourd'hui"
              hint="Profitez-en pour préparer les prochains rendez-vous."
              action={has('agenda.write') ? (
                <Button variant="primary" size="sm" icon="+" onClick={() => openAppointment({ defaults: { date: todayISO() } })}>
                  Nouveau rendez-vous
                </Button>
              ) : null}
            />
          ) : (
            <div style={{ padding: '4px 16px 12px' }}>
              {today.map((a) => (
                <div className="appointment-line" key={a.id}>
                  <span className="appointment-line__time">{timeOf(a.start_at)}</span>
                  <span className="dot" style={{ background: a.practitioner?.color || '#94a3b8' }} />
                  <span className="appointment-line__main">
                    <span className="appointment-line__name">{a.patient.full_name}</span>
                    <span className="appointment-line__meta">
                      <span>{a.practitioner?.full_name}</span>
                      <span>·</span>
                      <span>{a.duration_min} min</span>
                      {a.type && (<><span>·</span><span>{a.type.name}</span></>)}
                    </span>
                  </span>
                  <StatusBadge status={a.status} small />
                  <div className="row" style={{ gap: 4 }}>
                    <Button size="sm" variant="ghost" title="Message" onClick={() => openMessage({ appointment: a })}>✉</Button>
                    {has('agenda.write') && (
                      <Button size="sm" variant="secondary" onClick={() => openAppointment({ appointment: a, onSaved: load })}>
                        Modifier
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="stack">
          <Card title="Prochains rendez-vous" padded={false}>
            {loading ? (
              <Spinner />
            ) : next.length === 0 ? (
              <Empty title="Aucun rendez-vous à venir" hint="Les 14 prochains jours sont libres." />
            ) : (
              <div className="list">
                {next.slice(0, 8).map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="list-row"
                    onClick={() => openAppointment({ appointment: a, onSaved: load })}
                  >
                    <span className="list-row__time">{timeOf(a.start_at)}</span>
                    <span className="list-row__main">
                      <span className="list-row__name">{a.patient.full_name}</span>
                      <span className="list-row__meta">
                        {formatDateFr(a.date)} · {a.practitioner?.full_name} · {a.duration_min} min
                      </span>
                    </span>
                    <span className={cx('list-row__right')}>
                      <StatusBadge status={a.status} small />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card title="Raccourcis">
            <div className="stack" style={{ gap: 8 }}>
              {has('agenda.write') && (
                <Button variant="primary" block onClick={() => openAppointment({ defaults: { date: todayISO() } })}>
                  + Nouveau rendez-vous
                </Button>
              )}
              {has('patients.write') && (
                <Button variant="secondary" block onClick={() => openPatient({})}>
                  + Nouveau patient
                </Button>
              )}
              <Button variant="secondary" block onClick={() => navigate('/agenda?today=1')}>Voir aujourd'hui</Button>
              <Button variant="secondary" block onClick={() => navigate('/agenda')}>Créneau suivant disponible</Button>
            </div>
            <p className="muted small" style={{ marginTop: 10 }}>
              Rappel : la prise de rendez-vous complète prend moins d'une minute —
              patient, créneau libre, confirmation.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
