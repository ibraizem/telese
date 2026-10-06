/**
 * Orthophonistes : fiches, disponibilités hebdomadaires (jours travaillés,
 * horaires, pauses) et indisponibilités ponctuelles (congés, exceptions).
 * L'administrateur gère tout ; un orthophoniste gère les siennes si le
 * cabinet l'y autorise.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formError } from '../api';
import { useSession } from '../session';
import { useModals } from '../modals';
import { useToast } from '../toast';
import {
  Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, cx,
} from '../ui';
import { BLOCK_REASONS, WEEKDAYS } from '../status';
import { formatDateFr, todayISO } from '../date';

export default function Practitioners() {
  const { user, has } = useSession();
  const { openMessage, confirm } = useModals();
  const toast = useToast();

  const [list, setList] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('availability');
  const [editing, setEditing] = useState(null); // fiche en cours d'édition (admin)

  const isPractitioner = user.role === 'practitioner';
  const canManage = has('practitioners.manage');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get('/api/practitioners');
      const scoped = isPractitioner ? d.practitioners.filter((p) => p.id === user.practitioner_id) : d.practitioners;
      setList(scoped);
      setSelectedId((current) => current || user.practitioner_id || scoped[0]?.id || null);
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [isPractitioner, user.practitioner_id, toast]);

  useEffect(() => { load(); }, [load]);

  const selected = list.find((p) => p.id === Number(selectedId)) || null;
  const canEditAvailability =
    !!selected && (canManage || (isPractitioner && selected.can_edit_own_availability));

  async function removePractitioner(p) {
    const ok = await confirm({
      title: p.upcoming_count ? 'Désactiver cet orthophoniste ?' : 'Supprimer cet orthophoniste ?',
      message: p.upcoming_count
        ? `${p.full_name} a ${p.upcoming_count} rendez-vous à venir : la fiche sera désactivée (historique conservé).`
        : `${p.full_name} sera supprimé définitivement.`,
      confirmLabel: p.upcoming_count ? 'Désactiver' : 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/practitioners/${p.id}`);
      toast.push(p.upcoming_count ? 'Orthophoniste désactivé.' : 'Orthophoniste supprimé.');
      setSelectedId(null);
      load();
    } catch (err) {
      toast.push(err.message, 'error');
    }
  }

  if (loading) return <Card><Spinner label="Chargement…" /></Card>;

  return (
    <>
      <PageHeader
        title={isPractitioner ? 'Mes disponibilités' : 'Orthophonistes'}
        subtitle={
          isPractitioner
            ? 'Vos horaires de travail, pauses et indisponibilités.'
            : 'Fiches, horaires de travail, pauses et congés de chaque orthophoniste.'
        }
        actions={canManage && (
          <Button variant="primary" icon="+" onClick={() => setEditing({})}>Nouvel orthophoniste</Button>
        )}
      />

      <div className="split">
        <Card padded={false}>
          <div style={{ padding: 14, borderBottom: '1px solid var(--border)' }}>
            <strong>{list.length} orthophoniste{list.length > 1 ? 's' : ''}</strong>
          </div>
          <div className="list">
            {list.map((p) => (
              <button
                key={p.id}
                type="button"
                className={cx('list-row', Number(selectedId) === p.id && 'list-row--active')}
                onClick={() => setSelectedId(p.id)}
              >
                <span className="dot" style={{ background: p.color, width: 11, height: 11 }} />
                <span className="list-row__main">
                  <span className="list-row__name">{p.full_name}</span>
                  <span className="list-row__meta">
                    {p.upcoming_count ? `${p.upcoming_count} rendez-vous à venir` : 'Aucun rendez-vous à venir'}
                    {!p.active && ' · inactif'}
                  </span>
                </span>
                {p.has_custom_availability && <Badge tone="success">Horaires définis</Badge>}
              </button>
            ))}
            {list.length === 0 && <Empty title="Aucun orthophoniste" hint="Créez la première fiche." />}
          </div>
        </Card>

        {!selected ? (
          <Card><Empty title="Sélectionnez un orthophoniste" /></Card>
        ) : (
          <div className="stack">
            <Card>
              <div className="patient-header">
                <div>
                  <h2 className="row" style={{ gap: 9 }}>
                    <span className="dot" style={{ background: selected.color, width: 12, height: 12 }} />
                    {selected.full_name}
                  </h2>
                  <p className="muted">
                    {selected.email || '—'} {selected.phone ? `· ${selected.phone}` : ''}
                    {selected.can_edit_own_availability ? ' · peut modifier ses disponibilités' : ''}
                  </p>
                </div>
                <div className="row">
                  <Button variant="secondary" size="sm" onClick={() => setTab('availability')}>Disponibilités</Button>
                  <Button variant="secondary" size="sm" onClick={() => setTab('blocked')}>Congés & absences</Button>
                  {selected.email && (
                    <Button variant="secondary" size="sm" onClick={() => openMessage({ patient: { first_name: selected.first_name, last_name: selected.last_name, email: selected.email, phone: selected.phone } })}>
                      Message
                    </Button>
                  )}
                  {canManage && <Button variant="primary" size="sm" onClick={() => setEditing(selected)}>Modifier</Button>}
                </div>
              </div>
            </Card>

            {tab === 'availability' ? (
              <AvailabilityEditor
                key={selected.id}
                practitioner={selected}
                readOnly={!canEditAvailability}
                onSaved={load}
              />
            ) : (
              <BlockedTimes practitioner={selected} readOnly={!canManage && !isPractitioner} onChanged={load} />
            )}
          </div>
        )}
      </div>

      {editing !== null && (
        <PractitionerForm
          practitioner={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setSelectedId(null); load(); }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Disponibilités hebdomadaires                                        */
/* ------------------------------------------------------------------ */
function AvailabilityEditor({ practitioner, readOnly, onSaved }) {
  const toast = useToast();
  const { clinic } = useSession();
  const [days, setDays] = useState(() => fromSlots([]));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get(`/api/practitioners/${practitioner.id}/availability`)
      .then((d) => { if (alive) setDays(fromSlots(d.slots)); })
      .catch((err) => toast.push(err.message, 'error'))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [practitioner.id, toast]);

  async function save() {
    setSaving(true);
    try {
      await api.put(`/api/practitioners/${practitioner.id}/availability`, { slots: toSlots(days) });
      toast.push('Disponibilités enregistrées.');
      onSaved();
    } catch (err) {
      const { message, fields } = formError(err);
      toast.push(Object.values(fields)[0] || message, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Card><Spinner label="Chargement des disponibilités…" /></Card>;

  return (
    <Card
      title="Horaires de travail hebdomadaires"
      action={
        !readOnly && (
          <div className="row">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setDays((d) => {
                const monday = d[1];
                const copy = { ...d };
                [2, 3, 4, 5].forEach((n) => { copy[n] = { work: [...monday.work], breaks: [...monday.breaks] }; });
                return copy;
              })}
            >
              Copier lundi → vendredi
            </Button>
            <Button size="sm" variant="primary" onClick={save} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        )
      }
    >
      {readOnly && (
        <p className="muted small" style={{ marginBottom: 10 }}>
          Lecture seule : seuls l'administrateur (ou vous, si autorisé) peuvent modifier ces horaires.
        </p>
      )}

      {WEEKDAYS.map((d) => (
        <div className="availability-row" key={d.n}>
          <span className="availability-day">{d.long}</span>
          <div className="availability-slots">
            {days[d.n].work.length === 0 && days[d.n].breaks.length === 0 && (
              <span className="badge">Fermé</span>
            )}
            {days[d.n].work.map((iv, i) => (
              <span className="availability-slot" key={`w-${i}`}>
                <input type="time" value={iv.start} disabled={readOnly}
                  onChange={(e) => setDays((s) => updateRange(s, d.n, 'work', i, 'start', e.target.value))} />
                <span>–</span>
                <input type="time" value={iv.end} disabled={readOnly}
                  onChange={(e) => setDays((s) => updateRange(s, d.n, 'work', i, 'end', e.target.value))} />
                {!readOnly && (
                  <button type="button" title="Supprimer" onClick={() => setDays((s) => removeRange(s, d.n, 'work', i))}>×</button>
                )}
              </span>
            ))}
            {days[d.n].breaks.map((iv, i) => (
              <span className="availability-slot availability-slot--break" key={`b-${i}`}>
                <span className="small">Pause</span>
                <input type="time" value={iv.start} disabled={readOnly}
                  onChange={(e) => setDays((s) => updateRange(s, d.n, 'breaks', i, 'start', e.target.value))} />
                <span>–</span>
                <input type="time" value={iv.end} disabled={readOnly}
                  onChange={(e) => setDays((s) => updateRange(s, d.n, 'breaks', i, 'end', e.target.value))} />
                {!readOnly && (
                  <button type="button" title="Supprimer" onClick={() => setDays((s) => removeRange(s, d.n, 'breaks', i))}>×</button>
                )}
              </span>
            ))}
            {!readOnly && (
              <span className="row" style={{ gap: 5 }}>
                <Button
                  size="sm" variant="ghost"
                  onClick={() => setDays((s) => ({ ...s, [d.n]: { ...s[d.n], work: [...s[d.n].work, { start: clinic.day_start, end: clinic.day_end }] } }))}
                >
                  + Horaire
                </Button>
                <Button
                  size="sm" variant="ghost"
                  onClick={() => setDays((s) => ({ ...s, [d.n]: { ...s[d.n], breaks: [...s[d.n].breaks, { start: '13:00', end: '14:00' }] } }))}
                >
                  + Pause
                </Button>
              </span>
            )}
          </div>
        </div>
      ))}

      {!readOnly && (
        <div className="form-actions" style={{ marginTop: 8 }}>
          <span className="muted small">Sans horaire personnalisé, les horaires du cabinet ({clinic?.day_start}–{clinic?.day_end}) s'appliquent.</span>
          <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer les disponibilités'}</Button>
        </div>
      )}
    </Card>
  );
}

function fromSlots(slots) {
  const days = {};
  WEEKDAYS.forEach((d) => { days[d.n] = { work: [], breaks: [] }; });
  for (const s of slots || []) {
    const target = s.kind === 'break' ? days[s.weekday].breaks : days[s.weekday].work;
    target.push({ start: s.start_time, end: s.end_time, label: s.label });
  }
  return days;
}

function toSlots(days) {
  const out = [];
  WEEKDAYS.forEach((d) => {
    days[d.n].work.forEach((iv) => out.push({ weekday: d.n, start_time: iv.start, end_time: iv.end, kind: 'work' }));
    days[d.n].breaks.forEach((iv) => out.push({ weekday: d.n, start_time: iv.start, end_time: iv.end, kind: 'break', label: 'Pause' }));
  });
  return out;
}

function updateRange(days, weekday, key, index, field, value) {
  const copy = { ...days, [weekday]: { ...days[weekday], [key]: [...days[weekday][key]] } };
  copy[weekday][key][index] = { ...copy[weekday][key][index], [field]: value };
  return copy;
}

function removeRange(days, weekday, key, index) {
  const copy = { ...days, [weekday]: { ...days[weekday], [key]: days[weekday][key].filter((_, i) => i !== index) } };
  return copy;
}

/* ------------------------------------------------------------------ */
/* Congés / pauses / indisponibilités                                   */
/* ------------------------------------------------------------------ */
function BlockedTimes({ practitioner, readOnly, onChanged }) {
  const toast = useToast();
  const { user } = useSession();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ date: todayISO(), start_time: '09:00', end_time: '18:00', reason: 'conge', note: '' });
  const [message, setMessage] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const from = todayISO();
    api.get(`/api/blocked-times?from=${from}&practitioner_id=${practitioner.id}`)
      .then((d) => setItems(d.blocked_times))
      .catch((err) => toast.push(err.message, 'error'))
      .finally(() => setLoading(false));
  }, [practitioner.id, toast]);

  useEffect(() => { load(); }, [load]);

  async function add(e) {
    e.preventDefault();
    setMessage('');
    try {
      await api.post('/api/blocked-times', { ...form, practitioner_id: practitioner.id });
      toast.push('Indisponibilité enregistrée.');
      setForm({ date: todayISO(), start_time: '09:00', end_time: '18:00', reason: 'conge', note: '' });
      load();
      onChanged();
    } catch (err) {
      const { message: msg, fields } = formError(err);
      setMessage(Object.values(fields)[0] || msg);
    }
  }

  async function remove(item) {
    try {
      await api.del(`/api/blocked-times/${item.id}`);
      toast.push('Indisponibilité supprimée.');
      load();
      onChanged();
    } catch (err) {
      toast.push(err.message, 'error');
    }
  }

  const mayAdd = !readOnly && (user.role !== 'practitioner' || user.practitioner_id === practitioner.id);

  return (
    <Card title="Congés, pauses et indisponibilités à venir">
      <form className="form-grid form-grid--3" onSubmit={add} style={{ marginBottom: 14 }}>
        <Field label="Date" required>
          <Input type="date" value={form.date} min={todayISO()} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} disabled={!mayAdd} />
        </Field>
        <Field label="Début" required>
          <Input type="time" value={form.start_time} onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} disabled={!mayAdd} />
        </Field>
        <Field label="Fin" required>
          <Input type="time" value={form.end_time} onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))} disabled={!mayAdd} />
        </Field>
        <Field label="Motif" required>
          <Select value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} disabled={!mayAdd}>
            {Object.entries(BLOCK_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Note" className="span-2">
          <Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} disabled={!mayAdd} placeholder="Ex. remplaçante assurée par…" />
        </Field>
        <div className="span-3" style={{ gridColumn: '1 / -1' }}>
          {message && <p className="field__error" style={{ marginBottom: 8 }}>{message}</p>}
          {mayAdd && <Button type="submit" variant="primary">Ajouter cette indisponibilité</Button>}
        </div>
      </form>

      {loading ? (
        <Spinner label="Chargement…" />
      ) : items.length === 0 ? (
        <Empty title="Aucune indisponibilité à venir" hint="Congés, pauses et jours exceptionnels apparaîtront ici (et barreront l'agenda)." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Horaire</th><th>Motif</th><th>Note</th><th></th></tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id}>
                  <td>{formatDateFr(b.date)} <span className="muted small">({new Date(`${b.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long' })})</span></td>
                  <td>{b.start_time} – {b.end_time}</td>
                  <td><Badge tone={b.reason === 'conge' ? 'warning' : 'neutral'}>{b.reason_label}</Badge></td>
                  <td>{b.note || '—'}</td>
                  <td className="actions">
                    {mayAdd && <Button size="sm" variant="ghost" onClick={() => remove(b)}>×</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Fiche orthophoniste (administrateur)                                */
/* ------------------------------------------------------------------ */
function PractitionerForm({ practitioner, onClose, onSaved }) {
  const toast = useToast();
  const editing = !!practitioner?.id;
  const [form, setForm] = useState({
    first_name: practitioner?.first_name || '',
    last_name: practitioner?.last_name || '',
    email: practitioner?.email || '',
    phone: practitioner?.phone || '',
    color: practitioner?.color || '#4f6bed',
    active: practitioner ? practitioner.active : true,
    can_edit_own_availability: practitioner?.can_edit_own_availability || false,
  });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.checked ?? e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setMessage('');
    try {
      if (editing) await api.patch(`/api/practitioners/${practitioner.id}`, form);
      else await api.post('/api/practitioners', form);
      toast.push(editing ? 'Fiche mise à jour.' : 'Orthophoniste créé.');
      onSaved();
    } catch (err) {
      const { message: msg, fields } = formError(err);
      setErrors(fields);
      setMessage(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={editing ? `Modifier ${practitioner.full_name}` : 'Nouvel orthophoniste'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button variant="primary" onClick={submit} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</Button>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        {message && <div className="toast toast--error" style={{ position: 'static', cursor: 'default' }}>{message}</div>}
        <div className="form-grid">
          <Field label="Prénom" required error={errors.first_name}>
            <Input value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} error={errors.first_name} />
          </Field>
          <Field label="Nom" required error={errors.last_name}>
            <Input value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} error={errors.last_name} />
          </Field>
          <Field label="E-mail" error={errors.email}>
            <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} error={errors.email} />
          </Field>
          <Field label="Téléphone">
            <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </Field>
          <Field label="Couleur dans l'agenda">
            <Input type="color" value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} style={{ height: 38, padding: 3 }} />
          </Field>
          <div className="stack" style={{ gap: 8, justifyContent: 'center' }}>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={!!form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
              Actif (apparaît dans l'agenda)
            </label>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={!!form.can_edit_own_availability} onChange={(e) => setForm((f) => ({ ...f, can_edit_own_availability: e.target.checked }))} />
              Peut modifier ses propres disponibilités
            </label>
          </div>
        </div>
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="primary" disabled={saving}>Enregistrer</Button>
        </div>
      </form>
    </Modal>
  );
}
