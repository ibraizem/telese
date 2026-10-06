/** Fenêtre de confirmation (suppression, annulation, actions sensibles). */
import { Button, Modal } from '../ui';

export default function ConfirmDialog({ title, message, detail, confirmLabel = 'Confirmer', danger, onConfirm, onCancel }) {
  return (
    <Modal
      size="sm"
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Annuler</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <p>{message}</p>
      {detail && <p className="muted small" style={{ marginTop: 8 }}>{detail}</p>}
    </Modal>
  );
}
