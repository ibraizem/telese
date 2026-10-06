/**
 * Communication (V1) : génération des messages à partir des modèles.
 * 3 actions : copier le texte, ouvrir WhatsApp (wa.me), envoyer par e-mail.
 * Aucune API payante n'est appelée : l'architecture (table `messages`,
 * modèle de gabarit, canal) permet de brancher l'envoi automatique en V2.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useToast } from '../toast';
import { Button, Field, Modal, Select, Spinner } from '../ui';
import { formatDateFr } from '../date';

const normPhone = (phone) => String(phone || '').replace(/[^\d]/g, '');

export default function MessageModal({ appointment, patient, onClose }) {
  const toast = useToast();
  const [templates, setTemplates] = useState(null);
  const [key, setKey] = useState('confirmation');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);

  const target = useMemo(
    () => patient || appointment?.patient || null,
    [patient, appointment]
  );

  useEffect(() => {
    api.get('/api/messages/templates')
      .then((d) => setTemplates(d.templates))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!templates?.length) return;
    api
      .post('/api/messages/render', {
        template_key: key,
        patient_id: target?.id,
        appointment_id: appointment?.id,
        date: appointment?.date,
        time: appointment?.time,
      })
      .then((d) => setBody(d.body))
      .catch((err) => toast.push(err.message, 'error'));
  }, [templates, key, appointment, target, toast]);

  const waNumber = normPhone(target?.whatsapp || target?.phone).replace(/^0/, '212').replace(/^212212/, '212');
  const whatsappUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(body)}`;
  const mailtoUrl = `mailto:${target?.email || ''}?subject=${encodeURIComponent(
    'Votre rendez-vous au cabinet d\'orthophonie'
  )}&body=${encodeURIComponent(body)}`;

  async function logAnd(action, channel) {
    try {
      await api.post('/api/messages', {
        template_key: key,
        channel,
        body,
        patient_id: target?.id,
        appointment_id: appointment?.id,
      });
    } catch { /* le journal est best-effort */ }
    if (action) action();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(body);
      toast.push('Message copié dans le presse-papiers.');
    } catch {
      // Repli navigateurs anciens / contexte non sécurisé
      const el = document.createElement('textarea');
      el.value = body;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      el.remove();
      toast.push('Message copié dans le presse-papiers.');
    }
    logAnd(null, 'copy');
  }

  return (
    <Modal
      size="md"
      title="Envoyer un message"
      subtitle={
        target
          ? `${target.first_name || ''} ${target.last_name || ''}`.trim() +
            (appointment ? ` · rendez-vous du ${formatDateFr(appointment.date)} à ${appointment.time}` : '')
          : undefined
      }
      onClose={onClose}
      footer={<Button variant="ghost" onClick={onClose}>Fermer</Button>}
    >
      <div className="stack">
        <Field label="Modèle de message">
          <Select value={key} onChange={(e) => setKey(e.target.value)} disabled={loading || !templates?.length}>
            {(templates || []).map((t) => (
              <option key={t.template_key} value={t.template_key}>{t.name}</option>
            ))}
          </Select>
        </Field>

        {loading ? (
          <Spinner label="Génération du message…" />
        ) : (
          <>
            <div className="message-preview" contentEditable={false}>{body}</div>
            <p className="muted small">
              Le message peut être modifié ci-dessus avant envoi. La V1 génère le texte :
              l'envoi automatique (WhatsApp Business, e-mail transactionnel) sera branché en V2.
            </p>

            <div className="message-actions">
              <Button variant="primary" icon="⧉" onClick={copy}>Copier le message</Button>
              <Button
                variant="secondary"
                icon="✆"
                disabled={!waNumber}
                onClick={() => {
                  logAnd(() => window.open(whatsappUrl, '_blank', 'noopener'), 'whatsapp');
                }}
              >
                Ouvrir WhatsApp
              </Button>
              <Button
                variant="secondary"
                icon="✉"
                disabled={!target?.email}
                onClick={() => {
                  logAnd(() => { window.location.href = mailtoUrl; }, 'email');
                }}
              >
                Envoyer par e-mail
              </Button>
            </div>

            {!waNumber && (
              <p className="field__error">Aucun numéro WhatsApp/téléphone renseigné pour ce patient.</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
