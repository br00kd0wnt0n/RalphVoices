import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Dashboard } from '@/pages/Dashboard';
import { Projects } from '@/pages/Projects';
import { Personas } from '@/pages/Personas';
import { TestStudio } from '@/pages/TestStudio';
import { NewTest } from '@/pages/NewTest';
import { TestResultsPage } from '@/pages/TestResults';
import { Settings } from '@/pages/Settings';
import { HowItWorks } from '@/pages/HowItWorks';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="projects" element={<Projects />} />
          <Route path="personas" element={<Personas />} />
          <Route path="tests" element={<TestStudio />} />
          <Route path="tests/new" element={<NewTest />} />
          <Route path="tests/:id" element={<TestResultsPage />} />
          <Route path="settings" element={<Settings />} />
          <Route path="how-it-works" element={<HowItWorks />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
