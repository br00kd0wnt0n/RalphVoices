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

// B1-lite Copy Studio: a local, dev-only page that talks to `scripts/studio.ts serve`
// on 127.0.0.1. Not routed in production builds unless VITE_STUDIO_API is set.
const STUDIO_ENABLED = import.meta.env.DEV || !!import.meta.env.VITE_STUDIO_API;

// Route guard — redirects unauthenticated users to /login while preserving
// the original destination so we can return there post-login.
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return null; // brief while auth.me() resolves on first paint
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        {STUDIO_ENABLED && <Route path="/studio" element={<Studio />} />}
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
