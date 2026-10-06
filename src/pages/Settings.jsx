/**
 * Paramètres du cabinet (réservés à l'administrateur) :
 * horaires et identité du cabinet, utilisateurs et rôles,
 * types de rendez-vous, modèles de message, journal des actions.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, formError } from '../api';
import { useSession } from '../session';
import { useModals } from '../modals';
import { useToast } from '../toast';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '../ui';
import { ROLES } from '../status';

const TABS = [
  ['clinic', 'Cabinet'],
  ['users', 'Utilisateurs'],
  ['types', 'Types de rendez-vous'],
  ['messages', 'Modèles de message'],
  ['activity', 'Journal des actions'],
];

export default function Settings() {
  const { has } = useSession();
  const [tab, setTab] = useState('clinic');

  if (!has('users.manage')) {
    return (
      <Card>
        <Empty title="Accès réservé à l'administrateur" hint="Contactez l'administrateur du cabinet pour modifier les paramètres." />
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title="Paramètres"
        subtitle="Configuration du cabinet, comptes utilisateurs et journal d'activité."
      />

      <div className="tabs">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            style={tab === key ? { color: 'var(--primary)', borderBottomColor: 'var(--primary)' } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'clinic' && <ClinicSettings />}
      {tab === 'users' && <UsersSettings />}
      {tab === 'types' && <TypesSettings />}
      {tab === 'messages' && <MessagesSettings />}
      {tab === 'activity' && <ActivityLog />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Cabinet                                                             */
/* ------------------------------------------------------------------ */
function ClinicSettings() {
  const { clinic, refresh } = useSession();
  const toast = useToast();
  const [form, setForm] = useState(clinic || {});
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => { setForm(clinic || {}); }, [clinic]);

  async function save(e) {
    e?.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await api.put('/api/admin/settings', form);
      await refresh();
      toast.push('Paramètres du cabinet enregistrés.');
    } catch (err) {
      const { message, fields } = formError(err);
      setErrors(fields);
      toast.push(message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Identité et horaires du cabinet">
      <form className="stack" onSubmit={save}>
        <div className="form-grid">
          <Field label="Nom du cabinet" required error={errors.name}>
            <Input value={form.name || ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} error={errors.name} />
          </Field>
          <Field label="Téléphone">
            <Input value={form.phone || ''} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </Field>
          <Field label="Adresse">
            <Input value={form.address || ''} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          </Field>
          <Field label="Ville">
            <Input value={form.city || ''} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
          </Field>
          <Field label="Ouverture" required error={errors.day_start}>
            <Input type="time" value={form.day_start || '09:00'} onChange={(e) => setForm((f) => ({ ...f, day_start: e.target.value }))} />
          </Field>
          <Field label="Fermeture" required error={errors.day_end}>
            <Input type="time" value={form.day_end || '18:00'} onChange={(e) => setForm((f) => ({ ...f, day_end: e.target.value }))} error={errors.day_end} />
          </Field>
          <Field label="Pas de l'agenda" required error={errors.slot_minutes} hint="Grain des créneaux proposés (30 min par défaut)">
            <Select value={form.slot_minutes || 30} onChange={(e) => setForm((f) => ({ ...f, slot_minutes: Number(e.target.value) }))}>
              <option value={15}>15 minutes</option>
              <option value={20}>20 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={45}>45 minutes</option>
              <option value={60}>60 minutes</option>
            </Select>
          </Field>
          <Field label="Fuseau horaire">
            <Input value={form.timezone || ''} disabled />
          </Field>
        </div>
        <div className="form-actions">
          <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</Button>
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Utilisateurs                                                        */
/* ------------------------------------------------------------------ */
function UsersSettings() {
  const { user: me, refresh } = useSession();
  const { confirm } = useModals();
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [practitioners, setPractitioners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.get('/api/admin/users'), api.get('/api/practitioners')])
      .then(([u, p]) => { setUsers(u.users); setPractitioners(p.practitioners); })
      .catch((err) => toast.push(err.message, 'error'))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function toggleActive(u) {
    try {
      await api.patch(`/api/admin/users/${u.id}`, { active: !u.active });
      toast.push(u.active ? 'Compte désactivé.' : 'Compte réactivé.');
      load();
      refresh();
    } catch (err) {
      toast.push(err.message, 'error');
    }
  }

  async function remove(u) {
    const ok = await confirm({
      title: 'Supprimer cet utilisateur ?',
      message: `${u.name} perdra immédiatement l'accès à l'application.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/admin/users/${u.id}`);
      toast.push('Utilisateur supprimé.');
      load();
    } catch (err) {
      toast.push(err.message, 'error');
    }
  }

  if (loading) return <Card><Spinner label="Chargement…" /></Card>;

  return (
    <Card
      title="Comptes et rôles"
      action={<Button variant="primary" size="sm" icon="+" onClick={() => setEditing({})}>Nouvel utilisateur</Button>}
      padded={false}
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Orthophoniste lié</th><th>Dernière connexion</th><th>État</th><th></th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="strong">{u.name}{u.id === me.id && <span className="muted"> (vous)</span>}</td>
                <td>{u.email}</td>
                <td><Badge tone={u.role === 'admin' ? 'primary' : u.role === 'secretary' ? 'info' : 'success'}>{u.role_label}</Badge></td>
                <td>{u.practitioner_name || '—'}</td>
                <td>{u.last_login_at ? new Date(`${u.last_login_at.replace(' ', 'T')}Z`).toLocaleString('fr-FR') : 'Jamais'}</td>
                <td>{u.active ? <Badge tone="success">Actif</Badge> : <Badge tone="danger">Inactif</Badge>}</td>
                <td className="actions">
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(u)}>Modifier</Button>
                    {u.id !== me.id && (
                      <Button size="sm" variant="ghost" onClick={() => toggleActive(u)}>{u.active ? 'Désactiver' : 'Activer'}</Button>
                    )}
                    {u.id !== me.id && <Button size="sm" variant="ghost" onClick={() => remove(u)}>×</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ padding: 14, borderTop: '1px solid var(--border)' }}>
        <p className="muted small">
          <strong>Administrateur</strong> : accès complet (utilisateurs, orthophonistes, horaires, statistiques).<br />
          <strong>Télésecrétaire</strong> : agenda, patients, rendez-vous, liste d'attente, messages.<br />
          <strong>Orthophoniste</strong> : son agenda, informations administratives des patients, ses disponibilités.
        </p>
      </div>

      {editing !== null && (
        <UserForm
          user={editing.id ? editing : null}
          practitioners={practitioners}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </Card>
  );
}

function UserForm({ user, practitioners, onClose, onSaved }) {
  const toast = useToast();
  const editing = !!user?.id;
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    role: user?.role || 'secretary',
    practitioner_id: user?.practitioner_id || '',
    password: '',
    active: user ? user.active : true,
  });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setMessage('');
    try {
      const payload = { ...form, practitioner_id: form.practitioner_id ? Number(form.practitioner_id) : null };
      if (editing) await api.patch(`/api/admin/users/${user.id}`, payload);
      else await api.post('/api/admin/users', payload);
      toast.push(editing ? 'Utilisateur mis à jour.' : 'Utilisateur créé.');
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
      title={editing ? `Modifier ${user.name}` : 'Nouvel utilisateur'}
      subtitle={editing ? 'Laissez le mot de passe vide pour le conserver.' : 'Le mot de passe doit contenir au moins 8 caractères.'}
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
          <Field label="Nom complet" required error={errors.name}>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} error={errors.name} />
          </Field>
          <Field label="E-mail" required error={errors.email}>
            <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} error={errors.email} />
          </Field>
          <Field label="Rôle" required error={errors.role}>
            <Select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
              {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          {form.role === 'practitioner' && (
            <Field label="Orthophoniste associé" required error={errors.practitioner_id}>
              <Select value={form.practitioner_id} onChange={(e) => setForm((f) => ({ ...f, practitioner_id: e.target.value }))} error={errors.practitioner_id}>
                <option value="">— Sélectionner —</option>
                {practitioners.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </Select>
            </Field>
          )}
          <Field label={editing ? 'Nouveau mot de passe' : 'Mot de passe'} required={!editing} error={errors.password} hint="8 caractères minimum">
            <Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} error={errors.password} autoComplete="new-password" />
          </Field>
          <label className="row" style={{ alignSelf: 'end', paddingBottom: 8 }}>
            <input type="checkbox" checked={!!form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
            Compte actif
          </label>
        </div>
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="primary" disabled={saving}>Enregistrer</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Types de rendez-vous                                                */
/* ------------------------------------------------------------------ */
function TypesSettings() {
  const toast = useToast();
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState({ name: '', duration_min: 30, color: '#4f6bed' });
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/api/admin/appointment-types')
      .then((d) => setTypes(d.types))
      .catch((err) => toast.push(err.message, 'error'))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function submit(e) {
    e.preventDefault();
    try {
      if (editingId) await api.patch(`/api/admin/appointment-types/${editingId}`, form);
      else await api.post('/api/admin/appointment-types', form);
      toast.push(editingId ? 'Type mis à jour.' : 'Type ajouté.');
      setForm({ name: '', duration_min: 30, color: '#4f6bed' });
      setEditingId(null);
      load();
    } catch (err) {
      const { message, fields } = formError(err);
      toast.push(Object.values(fields)[0] || message, 'error');
    }
  }

  async function remove(t) {
    try {
      await api.del(`/api/admin/appointment-types/${t.id}`);
      toast.push('Type supprimé.');
      load();
    } catch (err) {
      toast.push(err.message, 'error');
    }
  }

  if (loading) return <Card><Spinner label="Chargement…" /></Card>;

  return (
    <Card title="Types de rendez-vous">
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Nom</th><th>Durée par défaut</th><th>Couleur</th><th>État</th><th></th></tr></thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id}>
                <td className="strong">{t.name}</td>
                <td>{t.duration_min} min</td>
                <td><span className="dot" style={{ background: t.color }} /></td>
                <td>{t.active ? <Badge tone="success">Actif</Badge> : <Badge>Inactif</Badge>}</td>
                <td className="actions">
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                    <Button size="sm" variant="secondary" onClick={() => { setEditingId(t.id); setForm({ name: t.name, duration_min: t.duration_min, color: t.color }); }}>Modifier</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(t)}>×</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="form-grid" onSubmit={submit} style={{ marginTop: 14, maxWidth: 620 }}>
        <Field label={editingId ? 'Modifier le type' : 'Nouveau type'} required>
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex. Bilan orthophonique" />
        </Field>
        <Field label="Durée (minutes)">
          <Select value={form.duration_min} onChange={(e) => setForm((f) => ({ ...f, duration_min: Number(e.target.value) }))}>
            {[15, 20, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{d} min</option>)}
          </Select>
        </Field>
        <Field label="Couleur">
          <Input type="color" value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} style={{ height: 38, padding: 3 }} />
        </Field>
        <div className="row" style={{ alignSelf: 'end', gap: 8 }}>
          <Button type="submit" variant="primary">{editingId ? 'Enregistrer' : 'Ajouter'}</Button>
          {editingId && (
            <Button variant="ghost" onClick={() => { setEditingId(null); setForm({ name: '', duration_min: 30, color: '#4f6bed' }); }}>
              Annuler
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Modèles de message                                                  */
/* ------------------------------------------------------------------ */
function MessagesSettings() {
  const toast = useToast();
  const [templates, setTemplates] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/api/messages/templates')
      .then((d) => setTemplates(d.templates))
      .catch((err) => toast.push(err.message, 'error'));
  }, [toast]);

  async function save() {
    setSaving(true);
    try {
      const d = await api.put('/api/messages/templates', { templates });
      setTemplates(d.templates);
      toast.push('Modèles enregistrés.');
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!templates) return <Card><Spinner label="Chargement des modèles…" /></Card>;

  return (
    <Card
      title="Modèles de message"
      action={<Button variant="primary" size="sm" onClick={save} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</Button>}
    >
      <p className="muted small" style={{ marginBottom: 12 }}>
        Variables disponibles : <strong>[Prénom]</strong>, <strong>[Nom]</strong>, <strong>[Date]</strong>, <strong>[Heure]</strong>, <strong>[Téléphone]</strong>.
        La V1 génère le texte (copie / WhatsApp / e-mail) ; l'envoi automatique sera branché en V2.
      </p>

      <div className="stack">
        {templates.map((t, i) => (
          <Field key={t.template_key} label={`${t.name} (${t.template_key})`}>
            <Textarea
              value={t.body}
              rows={2}
              onChange={(e) => setTemplates((list) => list.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))}
            />
          </Field>
        ))}
      </div>

      <div className="form-actions" style={{ marginTop: 12 }}>
        <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer les modèles'}</Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Journal des actions                                                 */
/* ------------------------------------------------------------------ */
function ActivityLog() {
  const toast = useToast();
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/admin/activity?limit=150${filter ? `&action=${filter}` : ''}`)
      .then((d) => setLogs(d.logs))
      .catch((err) => toast.push(err.message, 'error'))
      .finally(() => setLoading(false));
  }, [filter, toast]);

  const FILTERS = [
    ['', 'Tout'],
    ['appointment', 'Rendez-vous'],
    ['patient', 'Patients'],
    ['user', 'Utilisateurs'],
    ['availability', 'Disponibilités'],
    ['message', 'Messages'],
  ];

  return (
    <Card
      title="Journal des actions"
      action={
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 190 }}>
          {FILTERS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      }
    >
      {loading ? (
        <Spinner label="Chargement…" />
      ) : logs.length === 0 ? (
        <Empty title="Aucune action enregistrée" hint="Créations, modifications et annulations apparaîtront ici." />
      ) : (
        <div className="log-list">
          {logs.map((l) => (
            <div className="log-item" key={l.id}>
              <span className="log-item__dot" />
              <span>
                <div>{l.summary}</div>
                <div className="log-item__action">{l.action} · {l.user_name || 'Système'}</div>
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
