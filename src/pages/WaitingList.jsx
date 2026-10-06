/**
 * Liste d'attente : patients en attente d'un créneau.
 * Quand un rendez-vous est annulé, la télésecrétaire consulte cette page
 * et contacte les patients concernés (le créneau libéré est rappelé ici).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formError } from '../api';
import { useModals } from '../modals';
import { useSession } from '../session';
import { useToast } from '../toast';
import {
  Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, cx,
} from '../ui';
import { WAITING_STATUS } from '../status';
import { formatDateFr, todayISO } from '../date';

const TABS = [
  ['pending', 'En attente'],
  ['contacted', 'Patient contacté'],
  ['scheduled', 'Placé'],
  ['all', 'Tous'],
];

export default function WaitingList() {
  const { has } = useSession();
  const { openAppointment, confirm } = useModals();
  const toast = useToast();

  const [entries, setEntries] = useState([]);
  const [tab, setTab] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get(`/api/waiting-list?status=${tab}`);
      setEntries(d.entries);
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [tab, toast]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(entry, status) {
    try {
      await api.patch(`/api/waiting-list/${entry.id}`, { status });
      toast.push(`« ${entry.full_name} » : ${WAITING_STATUS[status].toLowerCase()}.`);
      load();
    } catch (err) {
      toast.push(err.message, 'error');
    }
  }

  async function schedule(entry) {
    openAppointment({
      defaults: {
        date: entry.desired_date || todayISO(),
        patient: entry.patient_id
          ? { id: entry.patient_id, first_name: entry.full_name.split(' ')[0], last_name: entry.full_name.split(' ').slice(1).join(' '), phone: entry.phone, full_name: entry.full_name }
          : null,
      },
      onSaved: async (appt) => {
        if (appt) {
          await api.patch(`/api/waiting-list/${entry.id}`, { status: 'scheduled', appointment_id: appt.id }).catch(() => {});
        }
        load();
      },
    });
  }

  async function remove(entry) {
    const ok = await confirm({
      title: 'Retirer de la liste d\'attente ?',
      message: `L'entrée de ${entry.full_name} sera supprimée.`,
      confirmLabel: 'Retirer',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/waiting-list/${entry.id}`);
      toast.push('Entrée retirée de la liste d\'attente.');
      load();
    } catch (err) {
      toast.push(err.message, 'error');
    }
  }

  const tone = (status) =>
    status === 'pending' ? 'warning' : status === 'contacted' ? 'info' : status === 'scheduled' ? 'success' : 'neutral';

  return (
    <>
      <PageHeader
        title="Liste d'attente"
        subtitle="Patients en attente d'un créneau libre — contactez-les dès qu'un rendez-vous est annulé."
        actions={has('waiting.write') && (
          <Button variant="primary" icon="+" onClick={() => setShowForm(true)}>Ajouter un patient</Button>
        )}
      />

      <div className="tabs">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" className={cx(tab === key && 'tabs__btn')} style={tab === key ? { color: 'var(--primary)', borderBottomColor: 'var(--primary)' } : undefined} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      <Card padded={false}>
        {loading ? (
          <Spinner label="Chargement…" />
        ) : entries.length === 0 ? (
          <Empty
            title="Aucun patient dans cette liste"
            hint="Ajoutez un patient dès qu'il demande un rendez-vous sans créneau disponible."
            action={has('waiting.write') && (
              <Button variant="primary" size="sm" onClick={() => setShowForm(true)}>Ajouter un patient</Button>
            )}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Téléphone</th>
                  <th>Type souhaité</th>
                  <th>Créneau souhaité</th>
                  <th>Préférence de jour</th>
                  <th>Statut</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <div className="strong">{e.full_name}</div>
                      {e.comment && <div className="muted small">{e.comment}</div>}
                    </td>
                    <td>{e.phone || '—'}</td>
                    <td>{e.appointment_type || '—'}</td>
                    <td>{e.desired_date ? formatDateFr(e.desired_date) : '—'}</td>
                    <td>{e.day_preference || '—'}</td>
                    <td><Badge tone={tone(e.status)}>{e.status_label}</Badge></td>
                    <td className="actions">
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                        {has('waiting.write') && e.status === 'pending' && (
                          <Button size="sm" variant="secondary" onClick={() => setStatus(e, 'contacted')}>Contacté</Button>
                        )}
                        {has('agenda.write') && e.status !== 'scheduled' && (
                          <Button size="sm" variant="primary" onClick={() => schedule(e)}>Placer</Button>
                        )}
                        {e.status === 'scheduled' && e.scheduled_start && (
                          <span className="badge badge--success">
                            {formatDateFr(e.scheduled_start.slice(0, 10))} {e.scheduled_start.slice(11, 16)}
                          </span>
                        )}
                        {has('waiting.write') && (
                          <Button size="sm" variant="ghost" title="Retirer" onClick={() => remove(e)}>×</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showForm && (
        <WaitingForm
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); setTab('pending'); load(); }}
        />
      )}
    </>
  );
}

function WaitingForm({ onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    full_name: '', phone: '', appointment_type: '', desired_date: '', day_preference: '', comment: '',
  });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setMessage('');
    try {
      await api.post('/api/waiting-list', form);
      toast.push('Patient ajouté à la liste d\'attente.');
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
      title="Ajouter à la liste d'attente"
      subtitle="Personne n'est disponible à la date souhaitée ? Inscrivez le patient ici."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button variant="primary" onClick={submit} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Ajouter'}
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        {message && <div className="toast toast--error" style={{ position: 'static', cursor: 'default' }}>{message}</div>}
        <div className="form-grid">
          <Field label="Patient (nom complet)" required error={errors.full_name}>
            <Input value={form.full_name} onChange={set('full_name')} error={errors.full_name} placeholder="Prénom Nom" />
          </Field>
          <Field label="Téléphone" error={errors.phone}>
            <Input value={form.phone} onChange={set('phone')} placeholder="+212 6 00 00 00 00" />
          </Field>
          <Field label="Type de rendez-vous">
            <Input value={form.appointment_type} onChange={set('appointment_type')} placeholder="Ex. Suivi, Bilan…" />
          </Field>
          <Field label="Créneau souhaité">
            <Input type="date" value={form.desired_date} onChange={set('desired_date')} min={todayISO()} />
          </Field>
          <Field label="Préférence de jour" className="span-2">
            <Input value={form.day_preference} onChange={set('day_preference')} placeholder="Ex. mardi ou jeudi après-midi" />
          </Field>
          <Field label="Commentaire" className="span-2">
            <Textarea value={form.comment} onChange={set('comment')} rows={2} maxLength={500} />
          </Field>
        </div>
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="primary" disabled={saving}>Ajouter</Button>
        </div>
      </form>
    </Modal>
  );
}
