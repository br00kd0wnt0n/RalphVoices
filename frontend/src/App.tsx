import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Dashboard } from '@/pages/Dashboard';
import { Projects } from '@/pages/Projects';
import { Personas } from '@/pages/Personas';
import { TestStudio } from '@/pages/TestStudio';
import { NewTest } from '@/pages/NewTest';
import { TestResultsPage } from '@/pages/TestResults';
import { Settings } from '@/pages/Settings';
import { HowItWorks } from '@/pages/HowItWorks';
import { Admin } from '@/pages/Admin';
import { Login } from '@/pages/Login';
import { useAuth } from '@/hooks/useAuth';
import { Studio } from '@/pages/Studio';
import { HOSTED } from '@/lib/studioApi';
import { inFrame, studioGate } from '@/lib/studioGate';
import { GatePanel, StudioErrorBoundary } from '@/components/studio/Gate';

// Route guard — redirects unauthenticated users to /login while preserving
// the original destination so we can return there post-login.
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return null; // brief while auth.me() resolves on first paint
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

// Hosted /studio: the same gate, but never blank. It says it's signing in, and inside the Narrativ shell (where
// /login can't help) it says how to sign in again; Studio makes no API call until sign-in has finished.
function StudioRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const gate = studioGate({ loading, signedIn: !!user, inFrame: inFrame() });
  if (gate === 'login') return <Navigate to="/login" replace state={{ from: location }} />;
  if (gate) return <GatePanel message={gate} />;
  return <StudioErrorBoundary><Studio /></StudioErrorBoundary>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Copy Studio: full-width, outside the Layout. Hosted it needs sign-in (and the server's STUDIO_EMAILS);
            locally it talks to `scripts/studio.ts serve` with no sign-in. Each step has its own path under it
            (/studio/assets…; lib/studioRoute.ts), which Studio reads itself. */}
        <Route path="/studio/*" element={HOSTED ? <StudioRoute /> : <StudioErrorBoundary><Studio /></StudioErrorBoundary>} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="projects" element={<Projects />} />
          <Route path="personas" element={<Personas />} />
          <Route path="tests" element={<TestStudio />} />
          <Route path="tests/new" element={<NewTest />} />
          <Route path="tests/:id" element={<TestResultsPage />} />
          <Route path="settings" element={<Settings />} />
          <Route path="how-it-works" element={<HowItWorks />} />
          <Route path="admin" element={<Admin />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
