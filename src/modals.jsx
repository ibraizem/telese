/**
 * Orchestration des fenêtres modales : un seul point d'ouverture pour
 * « nouveau rendez-vous », « nouveau patient », « message » et les
 * confirmations, utilisables depuis n'importe quelle page.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import AppointmentModal from './components/AppointmentModal';
import PatientModal from './components/PatientModal';
import MessageModal from './components/MessageModal';
import ConfirmDialog from './components/ConfirmDialog';

const ModalsContext = createContext(null);

export function ModalsProvider({ children }) {
  const [appointment, setAppointment] = useState(null);
  const [patient, setPatient] = useState(null);
  const [message, setMessage] = useState(null);
  const [confirmState, setConfirmState] = useState(null);

  const openAppointment = useCallback((opts = {}) => setAppointment(opts), []);
  const openPatient = useCallback((opts = {}) => setPatient(opts), []);
  const openMessage = useCallback((opts = {}) => setMessage(opts), []);

  const confirm = useCallback(
    (opts) => new Promise((resolve) => setConfirmState({ ...opts, resolve })),
    []
  );
  const answerConfirm = useCallback((value) => {
    setConfirmState((state) => {
      state?.resolve(value);
      return null;
    });
  }, []);

  const value = useMemo(
    () => ({ openAppointment, openPatient, openMessage, confirm }),
    [openAppointment, openPatient, openMessage, confirm]
  );

  return (
    <ModalsContext.Provider value={value}>
      {children}

      {appointment && (
        <AppointmentModal
          appointment={appointment.appointment}
          defaults={appointment.defaults}
          confirm={confirm}
          onClose={() => setAppointment(null)}
          onSaved={(a) => {
            appointment.onSaved?.(a);
          }}
        />
      )}

      {patient && (
        <PatientModal
          patient={patient.patient}
          onClose={() => setPatient(null)}
          onSaved={(p) => patient.onSaved?.(p)}
        />
      )}

      {message && (
        <MessageModal
          appointment={message.appointment}
          patient={message.patient}
          onClose={() => setMessage(null)}
        />
      )}

      {confirmState && (
        <ConfirmDialog
          title={confirmState.title}
          message={confirmState.message}
          detail={confirmState.detail}
          confirmLabel={confirmState.confirmLabel}
          danger={confirmState.danger}
          onConfirm={() => answerConfirm(true)}
          onCancel={() => answerConfirm(false)}
        />
      )}
    </ModalsContext.Provider>
  );
}

export function useModals() {
  const ctx = useContext(ModalsContext);
  if (!ctx) throw new Error('useModals doit être utilisé dans ModalsProvider');
  return ctx;
}
