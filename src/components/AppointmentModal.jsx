/**
 * Fenêtre « Nouveau rendez-vous » / « Modifier un rendez-vous ».
 *
 * Conçue pour la vitesse : le parcours téléphonique habituel est
 *   Patient → date → créneau disponible → confirmation.
 * Le double enregistrement est bloqué côté serveur (409) et les créneaux
 * occupés sont déjà grisés dans la grille.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formError } from '../api';
import { useSession } from '../session';
import { useToast } from '../toast';
import { STATUS_LIST } from '../status';
import { Button, Field, Input, Modal, Select, Spinner, StatusBadge, Textarea, cx } from '../ui';
import { addDays, formatDateFr, formatLongDate, isToday, todayISO } from '../date';

export default function AppointmentModal({ appointment, defaults = {}, confirm, onClose, onSaved }) {
  const { user } = useSession();
  const toast = useToast();
  const editing = !!appointment?.id;

  const [practitioners, setPractitioners] = useState([]);
  const [types, setTypes] = useState([]);
  const [ready, setReady] = useState(false);

  /* ---------------- patient ---------------- */
  const [patient, setPatient] = useState(appointment?.patient || defaults.patient || null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newPatient, setNewPatient] = useState({ first_name: '', last_name: '', phone: '' });

  /* ---------------- rendez-vous ---------------- */
  const [form, setForm] = useState({
    date: appointment?.date || defaults.date || todayISO(),
    time: appointment?.time || defaults.time || '',
    practitioner_id: appointment?.practitioner_id || defaults.practitioner_id || '',
    duration_min: appointment?.duration_min || defaults.duration_min || 30,
    type_id: appointment?.type_id || defaults.type_id || '',
    status: appointment?.status || defaults.status || 'confirmed',
    comment: appointment?.comment || defaults.comment || '',
  });
  const [customDuration, setCustomDuration] = useState(false);
  const [slots, setSlots] = useState(null);
  const [nextSlot, setNextSlot] = useState(null);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  /* Chargement des référentiels ------------------------------- */
  useEffect(() => {
    let alive = true;
    Promise.all([api.get('/api/practitioners'), api.get('/api/admin/appointment-types')])
      .then(([pr, ty]) => {
        if (!alive) return;
        const list = pr.practitioners.filter((p) => p.active || p.id === appointment?.practitioner_id);
        const scoped = user.role === 'practitioner' ? list.filter((p) => p.id === user.practitioner_id) : list;
        setPractitioners(scoped);
        setTypes(ty.types.filter((t) => t.active));
        setForm((f) => ({
          ...f,
          practitioner_id: f.practitioner_id || user.practitioner_id || scoped[0]?.id || '',
          type_id: f.type_id || ty.types[0]?.id || '',
        }));
        setReady(true);
      })
      .catch((err) => {
        setMessage(err.message);
        setReady(true);
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Recherche patient (saisie débouncée) ----------------------- */
  useEffect(() => {
    if (!query.trim()) { setResults([]); return undefined; }
    let alive = true;
    setSearching(true);
    const t = setTimeout(() => {
      api.get(`/api/patients?q=${encodeURIComponent(query.trim())}&limit=8`)
        .then((d) => { if (alive) setResults(d.patients); })
        .catch(() => { if (alive) setResults([]); })
        .finally(() => { if (alive) setSearching(false); });
    }, 180);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);

  /* Créneaux de la date / du praticien / de la durée ------------ */
  const loadSlots = useCallback(async () => {
    if (!form.practitioner_id || !form.date) return;
    try {
      const d = await api.get(
        `/api/appointments/meta/slots?date=${form.date}&practitioner_id=${form.practitioner_id}` +
        `&duration=${form.duration_min}${editing ? `&exclude=${appointment.id}` : ''}`
      );
      setSlots(d.slots);
      // Sélection par défaut : premier créneau libre.
      setForm((f) => {
        if (f.time && d.slots.some((s) => s.start === f.time && s.status === 'available')) return f;
        const first = d.slots.find((s) => s.status === 'available');
        return first ? { ...f, time: first.start } : f;
      });
    } catch (err) {
      setMessage(err.message);
    }
  }, [form.practitioner_id, form.date, form.duration_min, editing, appointment?.id]);

  useEffect(() => { loadSlots(); }, [loadSlots]);

  /* « Créneau suivant disponible » ----------------------------- */
  async function pickNextSlot() {
    if (!form.practitioner_id) return;
    try {
      const d = await api.get(
        `/api/appointments/meta/next-available?date=${form.date}&practitioner_id=${form.practitioner_id}` +
        `&duration=${form.duration_min}&from=${form.time || '00:00'}`
      );
      if (!d.slot) return toast.push('Aucun créneau disponible sur les 21 prochains jours.', 'info');
      setForm((f) => ({ ...f, date: d.slot.startAt.slice(0, 10), time: d.slot.startAt.slice(11, 16) }));
      toast.push(`Créneau proposé : ${formatDateFr(d.slot.startAt.slice(0, 10))} à ${d.slot.start}`, 'info');
    } catch (err) {
      toast.push(err.message, 'error');
    }
  }

  /* Création rapide d'un patient ------------------------------- */
  async function createPatient() {
    const res = await api.post('/api/patients', {
      first_name: newPatient.first_name,
      last_name: newPatient.last_name,
      phone: newPatient.phone,
    });
    setPatient(res.patient);
    setShowCreate(false);
    setQuery('');
    toast.push(`Patient « ${res.patient.full_name} » créé.`);
    return res.patient;
  }

  /* Enregistrement --------------------------------------------- */
  async function submit(e) {
    e?.preventDefault();
    setMessage('');
    setErrors({});
    if (!patient) {
      setMessage('Sélectionnez ou créez un patient.');
      return;
    }
    if (!form.time) {
      setMessage('Choisissez un créneau horaire.');
      return;
    }

    setSaving(true);
    try {
      let targetPatient = patient;
      if (!targetPatient.id) targetPatient = await createPatient();

      const payload = {
        patient_id: targetPatient.id,
        practitioner_id: Number(form.practitioner_id),
        type_id: form.type_id ? Number(form.type_id) : null,
        start_at: `${form.date}T${form.time}`,
        duration_min: Number(form.duration_min),
        status: form.status,
        comment: form.comment,
      };
      const res = editing
        ? await api.patch(`/api/appointments/${appointment.id}`, payload)
        : await api.post('/api/appointments', payload);
      toast.push(editing ? 'Rendez-vous modifié.' : 'Rendez-vous enregistré dans l\'agenda.');
      onSaved?.(res.appointment);
      onClose();
    } catch (err) {
      const { message: msg, fields } = formError(err);
      setErrors(fields);
      setMessage(msg);
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(status) {
    try {
      const res = await api.post(`/api/appointments/${appointment.id}/status`, { status });
      toast.push('Statut du rendez-vous mis à jour.');
      onSaved?.(res.appointment);
      onClose();
    } catch (err) {
      toast.push(err.message, 'error');
    }
  }

  async function remove() {
    const ok = await confirm({
      title: 'Supprimer le rendez-vous ?',
      message: 'Cette action retire définitivement le rendez-vous de l\'agenda.',
      detail: `${patient?.full_name} — ${formatDateFr(form.date)} à ${form.time}`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/appointments/${appointment.id}`);
      toast.push('Rendez-vous supprimé.');
      onSaved?.(null);
      onClose();
    } catch (err) {
      toast.push(err.message, 'error');
    }
  }

  const selectedSlot = slots?.find((s) => s.start === form.time);
  const slotTaken = selectedSlot && selectedSlot.status !== 'available';
  const durationOptions = [30, 45, 60];

  const subtitle = useMemo(() => {
    if (editing) return `${formatLongDate(form.date)} · ${form.time} · ${form.duration_min} min`;
    return 'Patient → créneau → confirmation (moins d\'une minute)';
  }, [editing, form.date, form.time, form.duration_min]);

  return (
    <Modal
      size="lg"
      title={editing ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous'}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          {editing && (
            <Button variant="soft-danger" onClick={() => changeStatus('cancelled')} style={{ marginRight: 'auto' }}>
              Annuler le RDV
            </Button>
          )}
          {editing && user.role !== 'practitioner' && (
            <Button variant="ghost" onClick={remove}>Supprimer</Button>
          )}
          <Button variant="ghost" onClick={onClose}>Fermer</Button>
          <Button variant="primary" onClick={submit} disabled={saving || !ready}>
            {saving ? 'Enregistrement…' : editing ? 'Enregistrer' : 'Confirmer le rendez-vous'}
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && (
          <div className="toast toast--error" style={{ position: 'static', cursor: 'default' }}>{message}</div>
        )}
        {editing && appointment && (
          <div className="row">
            <StatusBadge status={appointment.status} />
            <span className="muted small">Créé par {appointment.created_by_name || '—'}</span>
          </div>
        )}

        {/* ---------------- Patient ---------------- */}
        <section className="card card--padded">
          <header className="card__header">
            <h3 className="card__title">1. Patient</h3>
            {patient && (
              <span className="chip">
                {patient.full_name || `${patient.first_name} ${patient.last_name}`}
                {patient.phone ? ` · ${patient.phone}` : ''}
                <button type="button" onClick={() => setPatient(null)} aria-label="Changer de patient">×</button>
              </span>
            )}
          </header>

          {!patient && !showCreate && (
            <>
              <div className="search-input">
                <span className="search-input__icon" aria-hidden="true">⌕</span>
                <Input
                  autoFocus
                  placeholder="Rechercher par nom, prénom ou téléphone…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Rechercher un patient"
                />
              </div>

              {searching && <Spinner label="Recherche…" />}

              {results.length > 0 && (
                <div className="patient-results" style={{ marginTop: 8 }}>
                  {results.map((p) => (
                    <button key={p.id} type="button" className="patient-result" onClick={() => { setPatient(p); setQuery(''); }}>
                      <span className="avatar" style={{ background: '#eaeeff', color: '#2a46b8', width: 28, height: 28, fontSize: 11 }}>
                        {p.first_name[0]}{p.last_name[0]}
                      </span>
                      <span>
                        <span className="patient-result__name">{p.full_name}</span>
                        <span className="patient-result__meta" style={{ display: 'block' }}>
                          {p.phone || '—'} {p.appointments_count ? `· ${p.appointments_count} RDV` : ''}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {query && !searching && results.length === 0 && (
                <p className="muted small" style={{ marginTop: 8 }}>Aucun patient trouvé.</p>
              )}

              <div className="row" style={{ marginTop: 10 }}>
                <Button size="sm" variant="secondary" onClick={() => setShowCreate(true)}>+ Créer un nouveau patient</Button>
                {query && <Button size="sm" variant="ghost" onClick={() => setQuery('')}>Effacer la recherche</Button>}
              </div>
            </>
          )}

          {!patient && showCreate && (
            <div className="form-grid">
              <Field label="Prénom" required>
                <Input autoFocus value={newPatient.first_name} onChange={(e) => setNewPatient((v) => ({ ...v, first_name: e.target.value }))} />
              </Field>
              <Field label="Nom" required>
                <Input value={newPatient.last_name} onChange={(e) => setNewPatient((v) => ({ ...v, last_name: e.target.value }))} />
              </Field>
              <Field label="Téléphone" required>
                <Input value={newPatient.phone} onChange={(e) => setNewPatient((v) => ({ ...v, phone: e.target.value }))} placeholder="+212 6 00 00 00 00" />
              </Field>
              <div className="row" style={{ alignSelf: 'end' }}>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!newPatient.first_name.trim() || !newPatient.last_name.trim()}
                  onClick={() => createPatient().catch((err) => setMessage(formError(err).message))}
                >
                  Créer et sélectionner
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Annuler</Button>
              </div>
            </div>
          )}
        </section>

        {/* ---------------- Créneau ---------------- */}
        <section className="card card--padded">
          <header className="card__header">
            <h3 className="card__title">2. Date et créneau</h3>
            <Button size="sm" variant="secondary" onClick={pickNextSlot} disabled={!form.practitioner_id}>
              ⌁ Créneau suivant disponible
            </Button>
          </header>

          <div className="form-grid form-grid--3">
            <Field label="Date" required error={errors.start_at}>
              <Input type="date" value={form.date} onChange={set('date')} error={errors.start_at} />
            </Field>
            <Field label="Orthophoniste" required error={errors.practitioner_id}>
              <Select
                value={form.practitioner_id}
                onChange={set('practitioner_id')}
                error={errors.practitioner_id}
                disabled={user.role === 'practitioner'}
              >
                {practitioners.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Durée" required error={errors.duration_min}>
              <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                {durationOptions.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={cx('slot', String(form.duration_min) === String(d) && !customDuration && 'slot--selected')}
                    style={{ flex: 1, padding: '7px 4px' }}
                    onClick={() => { setCustomDuration(false); setForm((f) => ({ ...f, duration_min: d })); }}
                  >
                    {d}
                  </button>
                ))}
                <button
                  type="button"
                  className={cx('slot', customDuration && 'slot--selected')}
                  style={{ flex: 1, padding: '7px 4px' }}
                  onClick={() => setCustomDuration(true)}
                >
                  Autre
                </button>
              </div>
            </Field>
            {customDuration && (
              <Field label="Durée personnalisée (minutes)" error={errors.duration_min}>
                <Input
                  type="number" min="5" max="480" step="5"
                  value={form.duration_min}
                  onChange={(e) => setForm((f) => ({ ...f, duration_min: e.target.value }))}
                />
              </Field>
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 7 }}>
              <span className="field__label">Créneaux du {formatDateFr(form.date)} {isToday(form.date) && '(aujourd\'hui)'}</span>
              <span className="slot-legend">
                <span><i style={{ background: '#fff' }} /> Libre</span>
                <span><i style={{ background: '#f8fafc', borderStyle: 'dashed' }} /> Occupé / fermé</span>
                <span><i style={{ background: '#fdf3e0', borderStyle: 'solid' }} /> Pause / congé</span>
              </span>
            </div>

            {!slots ? (
              <Spinner label="Chargement des créneaux…" />
            ) : slots.every((s) => s.status !== 'available') ? (
              <p className="muted small">
                Aucun créneau libre ce jour-là pour cet orthophoniste. Essayez un autre jour ou « Créneau suivant disponible ».
              </p>
            ) : (
              <div className="slots">
                {slots.map((s) => (
                  <button
                    key={s.start}
                    type="button"
                    disabled={s.status !== 'available'}
                    title={
                      s.status === 'occupied' && s.appointment
                        ? `Occupé : ${s.appointment.pat_first} ${s.appointment.pat_last}`
                        : s.status === 'blocked' ? 'Pause / congé / indisponibilité'
                        : s.status === 'closed' ? 'Hors horaires de travail' : 'Disponible'
                    }
                    className={cx(
                      'slot',
                      s.status === 'occupied' && 'slot--occupied',
                      s.status === 'closed' && 'slot--closed',
                      s.status === 'blocked' && 'slot--blocked',
                      form.time === s.start && 'slot--selected'
                    )}
                    onClick={() => setForm((f) => ({ ...f, time: s.start }))}
                  >
                    {s.start}
                  </button>
                ))}
              </div>
            )}

            {slotTaken && (
              <p className="field__error" style={{ marginTop: 7 }}>
                {form.time} n'est pas disponible ({selectedSlot.status === 'blocked' ? 'pause / congé' : selectedSlot.status === 'closed' ? 'hors horaires' : 'occupé'}). Choisissez un autre créneau.
              </p>
            )}
          </div>
        </section>

        {/* ---------------- Détails ---------------- */}
        <section className="card card--padded">
          <header className="card__header"><h3 className="card__title">3. Détails</h3></header>
          <div className="form-grid form-grid--3">
            <Field label="Type de rendez-vous">
              <Select value={form.type_id} onChange={set('type_id')}>
                <option value="">— Aucun —</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.duration_min} min)</option>
                ))}
              </Select>
            </Field>
            <Field label="Statut" required error={errors.status}>
              <Select value={form.status} onChange={set('status')} error={errors.status}>
                {STATUS_LIST.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Date / heure" hint="Ajustables dans la section 2">
              <Input value={`${formatDateFr(form.date)} ${form.time || '--:--'}`} disabled />
            </Field>
            <Field label="Commentaire interne" className="span-2" hint="Visible uniquement par l'équipe du cabinet">
              <Textarea value={form.comment} onChange={set('comment')} maxLength={1000} rows={2} />
            </Field>
          </div>
        </section>
      </div>
    </Modal>
  );
}
