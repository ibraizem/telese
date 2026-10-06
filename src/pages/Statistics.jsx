/**
 * Statistiques du cabinet : volumes, statuts, nouveaux patients,
 * demandes et taux de transformation demande → rendez-vous.
 * Périodes : aujourd'hui / cette semaine / ce mois / plage libre.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { Button, Card, Empty, Field, Input, PageHeader, Spinner, StatCard } from '../ui';
import { formatDateFr, todayISO } from '../date';

const PERIODS = [
  ['today', "Aujourd'hui"],
  ['week', 'Cette semaine'],
  ['month', 'Ce mois'],
  ['custom', 'Période personnalisée'],
];

const STATUS_ROWS = [
  ['confirmed', 'Confirmés', 'var(--success)'],
  ['request', 'Demandes', 'var(--info)'],
  ['to_confirm', 'À confirmer', 'var(--warning)'],
  ['cancelled', 'Annulés', 'var(--danger)'],
  ['postponed', 'Reportés', 'var(--violet)'],
  ['absent', 'Absents', '#96376b'],
  ['done', 'Terminés', '#35566e'],
];

export default function Statistics() {
  const { has } = useSession();
  const [period, setPeriod] = useState('month');
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const allowed = has('stats.view');

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ period });
      if (period === 'custom') { params.set('from', from); params.set('to', to); }
      const d = await api.get(`/api/stats?${params}`);
      setData(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [period, from, to, allowed]);

  useEffect(() => { load(); }, [load]);

  if (!allowed) {
    return (
      <Card>
        <Empty title="Accès réservé à l'administrateur" hint="Les statistiques du cabinet sont visibles par le compte administrateur." />
      </Card>
    );
  }

  const maxDaily = Math.max(1, ...(data?.daily || []).map((d) => d.total));

  return (
    <>
      <PageHeader
        title="Statistiques"
        subtitle={data ? `Période du ${formatDateFr(data.from)} au ${formatDateFr(data.to)}` : ''}
        actions={
          <div className="segmented">
            {PERIODS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPeriod(key)}
                style={period === key ? { background: '#fff', boxShadow: 'var(--shadow)', color: 'var(--text)' } : undefined}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />

      {period === 'custom' && (
        <Card style={{ marginBottom: 14 }}>
          <div className="form-grid" style={{ maxWidth: 520 }}>
            <Field label="Du">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} max={to} />
            </Field>
            <Field label="Au">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} min={from} />
            </Field>
          </div>
        </Card>
      )}

      {loading ? (
        <Card><Spinner label="Calcul des statistiques…" /></Card>
      ) : error ? (
        <Card><Empty title="Impossible de charger les statistiques" hint={error} /></Card>
      ) : !data ? null : (
        <div className="stack">
          <div className="grid grid--stats">
            <StatCard label="Rendez-vous" value={data.total} tone="primary" icon="▦" />
            <StatCard label="Confirmés" value={data.statuses.confirmed} tone="success" icon="✓" />
            <StatCard label="Annulés" value={data.statuses.cancelled} tone="danger" icon="×" />
            <StatCard label="Reportés" value={data.statuses.postponed} tone="info" icon="→" />
            <StatCard label="Patients absents" value={data.statuses.absent} tone="warning" icon="!" />
            <StatCard label="Nouveaux patients" value={data.new_patients} tone="primary" icon="☺" />
            <StatCard label="Demandes de RDV" value={data.demandes} tone="warning" icon="◷" />
            <StatCard
              label="Taux de transformation"
              value={`${data.transformation_rate} %`}
              tone="success"
              icon="%"
              hint={data.demandes ? `${data.demandes_converties} demande(s) sur ${data.demandes}` : 'aucune demande sur la période'}
            />
          </div>

          <div className="grid grid--2">
            <Card title="Répartition par statut">
              <div className="breakdown">
                {STATUS_ROWS.map(([key, label, color]) => {
                  const value = data.statuses[key] || 0;
                  const pct = data.total ? Math.round((value / data.total) * 100) : 0;
                  return (
                    <div className="breakdown__row" key={key}>
                      <span>{label}</span>
                      <span className="breakdown__track">
                        <span className="breakdown__fill" style={{ width: `${pct}%`, background: color }} />
                      </span>
                      <span className="breakdown__value">{value}</span>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card title="Rendez-vous par jour">
              {data.daily.length === 0 ? (
                <Empty title="Aucun rendez-vous sur la période" />
              ) : (
                <div className="bar-chart">
                  {data.daily.map((d) => (
                    <div className="bar-chart__col" key={d.day} title={`${formatDateFr(d.day)} : ${d.total} rendez-vous`}>
                      <span className="bar-chart__value">{d.total}</span>
                      <span className="bar-chart__bar" style={{ height: `${(d.total / maxDaily) * 100}%` }} />
                      <span className="bar-chart__label">{Number(d.day.slice(8, 10))}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card title="Patients en liste d'attente">
            <div className="row" style={{ gap: 18 }}>
              <div>
                <div className="stat__value">{data.waiting_list}</div>
                <div className="muted small">patient(s) en attente d'un créneau</div>
              </div>
              <div>
                <div className="stat__value">{data.statuses.request}</div>
                <div className="muted small">demande(s) encore non confirmée(s)</div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => { window.location.href = '/waiting'; }}>
                Ouvrir la liste d'attente
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
