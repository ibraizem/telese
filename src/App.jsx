/** Routage de l'application et protection par session. */
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './session';
import { ModalsProvider, useModals } from './modals';
import { Spinner } from './ui';
import AppShell from './components/AppShell';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Agenda from './pages/Agenda';
import Patients from './pages/Patients';
import WaitingList from './pages/WaitingList';
import Practitioners from './pages/Practitioners';
import Statistics from './pages/Statistics';
import Settings from './pages/Settings';

function Shell({ children }) {
  const { openAppointment, openPatient } = useModals();
  return (
    <AppShell
      onNewAppointment={() => openAppointment({})}
      onNewPatient={() => openPatient({})}
    >
      {children}
    </AppShell>
  );
}

function Router() {
  return (
    <Routes>
      <Route path="/dashboard" element={<Shell><Dashboard /></Shell>} />
      <Route path="/agenda" element={<Shell><Agenda /></Shell>} />
      <Route path="/patients" element={<Shell><Patients /></Shell>} />
      <Route path="/patients/:id" element={<Shell><Patients /></Shell>} />
      <Route path="/waiting" element={<Shell><WaitingList /></Shell>} />
      <Route path="/practitioners" element={<Shell><Practitioners /></Shell>} />
      <Route path="/stats" element={<Shell><Statistics /></Shell>} />
      <Route path="/settings" element={<Shell><Settings /></Shell>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  const { user, loading } = useSession();

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <Spinner label="Chargement de l'application…" />
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <ModalsProvider>
      <Router />
    </ModalsProvider>
  );
}
