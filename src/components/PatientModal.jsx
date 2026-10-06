/**
 * Formulaire patient (création / modification).
 * Volontairement administratif uniquement : aucune donnée médicale en V1.
 */
import { useState } from 'react';
import { api, formError } from '../api';
import { useToast } from '../toast';
import { Button, Field, Input, Modal, Textarea } from '../ui';

export default function PatientModal({ patient, onClose, onSaved }) {
  const toast = useToast();
  const editing = !!patient?.id;
  const [form, setForm] = useState({
    first_name: patient?.first_name || '',
    last_name: patient?.last_name || '',
    phone: patient?.phone || '',
    whatsapp: patient?.whatsapp || '',
    email: patient?.email || '',
    birth_date: patient?.birth_date || '',
    guardian_name: patient?.guardian_name || '',
    guardian_phone: patient?.guardian_phone || '',
    admin_comment: patient?.admin_comment || '',
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
      const res = editing
        ? await api.patch(`/api/patients/${patient.id}`, form)
        : await api.post('/api/patients', form);
      toast.push(editing ? 'Fiche patient mise à jour.' : 'Patient enregistré.');
      onSaved?.(res.patient);
      onClose();
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
      size="lg"
      title={editing ? `Modifier ${patient.first_name} ${patient.last_name}` : 'Nouveau patient'}
      subtitle="Informations administratives uniquement — aucune donnée médicale n’est demandée."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button variant="primary" onClick={submit} disabled={saving}>
            {saving ? 'Enregistrement…' : editing ? 'Enregistrer les modifications' : 'Créer le patient'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="stack">
        {message && <div className="toast toast--error" style={{ position: 'static' }}>{message}</div>}

        <div className="form-grid">
          <Field label="Prénom" required error={errors.first_name}>
            <Input value={form.first_name} onChange={set('first_name')} error={errors.first_name} placeholder="Ex. Salma" />
          </Field>
          <Field label="Nom" required error={errors.last_name}>
            <Input value={form.last_name} onChange={set('last_name')} error={errors.last_name} placeholder="Ex. Bennani" />
          </Field>
          <Field label="Téléphone" required error={errors.phone}>
            <Input value={form.phone} onChange={set('phone')} error={errors.phone} placeholder="+212 6 00 00 00 00" inputMode="tel" />
          </Field>
          <Field label="WhatsApp" hint="S'il diffère du numéro principal">
            <Input value={form.whatsapp} onChange={set('whatsapp')} placeholder="+212 6 00 00 00 00" inputMode="tel" />
          </Field>
          <Field label="Adresse e-mail" error={errors.email}>
            <Input type="email" value={form.email} onChange={set('email')} error={errors.email} placeholder="patient@example.ma" />
          </Field>
          <Field label="Date de naissance" hint="Facultatif">
            <Input type="date" value={form.birth_date} onChange={set('birth_date')} />
          </Field>
          <Field label="Responsable légal" hint="Facultatif — pour les mineurs">
            <Input value={form.guardian_name} onChange={set('guardian_name')} placeholder="Nom du responsable" />
          </Field>
          <Field label="Téléphone du responsable légal">
            <Input value={form.guardian_phone} onChange={set('guardian_phone')} placeholder="+212 6 00 00 00 00" inputMode="tel" />
          </Field>
          <Field label="Commentaire administratif" className="span-2" hint="Organisation, préférences d\'horaire… (aucune information médicale)">
            <Textarea value={form.admin_comment} onChange={set('admin_comment')} maxLength={1000} />
          </Field>
        </div>

        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? 'Enregistrement…' : editing ? 'Enregistrer' : 'Créer le patient'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
