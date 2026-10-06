/**
 * Patients : recherche rapide (nom, prénom, téléphone), fiche détaillée
 * et historique des rendez-vous. Données strictement administratives.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../session';
import { useModals } from '../modals';
import { Button, Card, Empty, Input, PageHeader, Spinner, StatusBadge } from '../ui';
import { formatDateFr } from '../date';

export default function Patients() {
  const { has } = useSession();
  const { openPatient, openAppointment, openMessage } = useModals();
  const navigate = useNavigate();
  const { id } = useParams();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  /* Recherche débouncée ------------------------------------------- */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.get(`/api/patients?q=${encodeURIComponent(query)}&limit=60`)
        .then((d) => { if (alive) setResults(d.patients); })
        .catch(() => { if (alive) setResults([]); })
        .finally(() => { if (alive) setLoading(false); });
    }, 180);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);

  /* Fiche patient -------------------------------------------------- */
  const loadDetail = useCallback(() => {
    if (!id) { setSelected(null); return undefined; }
    let alive = true;
    setDetailLoading(true);
    api.get(`/api/patients/${id}`)
      .then((d) => { if (alive) setSelected(d); })
      .catch(() => { if (alive) navigate('/patients'); })
      .finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [id, navigate]);

  useEffect(() => loadDetail(), [loadDetail]);

  const appointmentCount = selected?.patient?.appointments_count;

  return (
    <>
      <PageHeader
        title="Patients"
        subtitle={`${results.length} patient${results.length > 1 ? 's' : ''}${query ? ' trouvé(s)' : ' enregistré(s)'}`}
        actions={
          has('patients.write') && (
            <Button
              variant="primary"
              icon="+"
              onClick={() => openPatient({})}
            >
              Nouveau patient
            </Button>
          )
        }
      />

      <div className="split">
        <Card padded={false}>
          <div style={{ padding: 14, borderBottom: '1px solid var(--border)' }}>
            <div className="search-input">
              <span className="search-input__icon" aria-hidden="true">⌕</span>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nom, prénom ou téléphone…"
                aria-label="Rechercher un patient"
                autoFocus={!id}
              />
            </div>
          </div>

          {loading ? (
            <Spinner label="Recherche…" />
          ) : results.length === 0 ? (
            <Empty title="Aucun patient" hint="Ajustez votre recherche ou créez un nouveau patient." />
          ) : (
            <div className="list" style={{ maxHeight: '62vh', overflowY: 'auto' }}>
              {results.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`list-row ${Number(id) === p.id ? 'list-row--active' : ''}`}
                  onClick={() => navigate(`/patients/${p.id}`)}
                >
                  <span className="avatar" style={{ background: '#eaeeff', color: '#2a46b8', width: 32, height: 32, fontSize: 12 }}>
                    {p.first_name[0]}{p.last_name[0]}
                  </span>
                  <span className="list-row__main">
                    <span className="list-row__name">{p.full_name}</span>
                    <span className="list-row__meta">
                      {p.phone || '—'}{p.appointments_count ? ` · ${p.appointments_count} RDV` : ''}
                    </span>
                  </span>
                  {p.next_appointment && (
                    <span className="badge badge--primary badge--sm" title="Prochain rendez-vous">
                      {formatDateFr(p.next_appointment)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </Card>

        {!id && (
          <Card>
            <Empty
              title="Sélectionnez un patient"
              hint="Cliquez sur un nom à gauche pour ouvrir sa fiche et son historique."
              action={has('patients.write') && (
                <Button variant="primary" size="sm" onClick={() => openPatient({})}>+ Nouveau patient</Button>
              )}
            />
          </Card>
        )}

        {id && detailLoading && !selected && <Card><Spinner label="Chargement de la fiche…" /></Card>}

        {id && selected && (
          <div className="stack">
            <Card>
              <div className="patient-header">
                <div>
                  <h2 className="patient-header__name">
                    {selected.patient.first_name} {selected.patient.last_name}
                  </h2>
                  <p className="muted">
                    {selected.patient.phone || 'Pas de téléphone'}
                    {selected.patient.email ? ` · ${selected.patient.email}` : ''}
                    {appointmentCount ? ` · ${appointmentCount} rendez-vous` : ''}
                  </p>
                </div>
                <div className="row">
                  {has('messages.send') && (
                    <Button variant="secondary" size="sm" icon="✉" onClick={() => openMessage({ patient: selected.patient })}>
                      Message
                    </Button>
                  )}
                  {has('patients.write') && (
                    <Button variant="secondary" size="sm" onClick={() => openPatient({ patient: selected.patient, onSaved: loadDetail })}>
                      Modifier
                    </Button>
                  )}
                  {has('agenda.write') && (
                    <Button variant="primary" size="sm" icon="+" onClick={() => openAppointment({ defaults: { patient: selected.patient }, onSaved: loadDetail })}>
                      Nouveau rendez-vous
                    </Button>
                  )}
                </div>
              </div>

              <dl className="kv" style={{ marginTop: 16 }}>
                <dt>Téléphone</dt><dd>{selected.patient.phone || '—'}</dd>
                <dt>WhatsApp</dt><dd>{selected.patient.whatsapp || '—'}</dd>
                <dt>E-mail</dt><dd>{selected.patient.email || '—'}</dd>
                <dt>Date de naissance</dt>
                <dd>{selected.patient.birth_date ? formatDateFr(selected.patient.birth_date) : '—'}</dd>
                <dt>Responsable légal</dt>
                <dd>
                  {selected.patient.guardian_name
                    ? `${selected.patient.guardian_name}${selected.patient.guardian_phone ? ` · ${selected.patient.guardian_phone}` : ''}`
                    : '—'}
                </dd>
                <dt>Commentaire</dt>
                <dd>{selected.patient.admin_comment || '—'}</dd>
                <dt>Liste d'attente</dt>
                <dd>
                  {selected.waiting?.length
                    ? <span className="badge badge--warning">En attente d'un créneau</span>
                    : '—'}
                </dd>
              </dl>
            </Card>

            <Card title="Historique des rendez-vous" padded={false}>
              {selected.appointments.length === 0 ? (
                <Empty
                  title="Aucun rendez-vous"
                  hint="Ce patient n'a pas encore de rendez-vous enregistré."
                  action={has('agenda.write') && (
                    <Button variant="primary" size="sm" onClick={() => openAppointment({ defaults: { patient: selected.patient }, onSaved: loadDetail })}>
                      Prendre un rendez-vous
                    </Button>
                  )}
                />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Heure</th>
                        <th>Orthophoniste</th>
                        <th>Type</th>
                        <th>Durée</th>
                        <th>Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.appointments.map((a) => (
                        <tr
                          key={a.id}
                          className="tr--clickable"
                          onClick={() => has('agenda.write') && openAppointment({ appointment: toShape(a, selected.patient), onSaved: loadDetail })}
                        >
                          <td>{formatDateFr(a.start_at.slice(0, 10))}</td>
                          <td className="num">{a.start_at.slice(11, 16)}</td>
                          <td>
                            <span className="row" style={{ gap: 6 }}>
                              <span className="dot" style={{ background: a.prac_color || '#94a3b8' }} />
                              {a.practitioner_name || '—'}
                            </span>
                          </td>
                          <td>{a.type_name || '—'}</td>
                          <td className="num">{a.duration_min} min</td>
                          <td><StatusBadge status={a.status} small /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </>
  );
}

/** Transforme une ligne d'historique au format agenda (pour la modale). */
function toShape(a, patient) {
  return {
    id: a.id,
    patient_id: a.patient_id,
    practitioner_id: a.practitioner_id,
    type_id: a.type_id,
    start_at: a.start_at,
    date: a.start_at.slice(0, 10),
    time: a.start_at.slice(11, 16),
    duration_min: a.duration_min,
    status: a.status,
    comment: a.comment,
    created_by_name: a.created_by_name,
    patient,
    practitioner: a.practitioner_id
      ? { id: a.practitioner_id, full_name: a.practitioner_name, color: a.prac_color }
      : null,
    type: a.type_id ? { id: a.type_id, name: a.type_name, color: a.type_color } : null,
  };
}
