import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Dashboard } from '@/pages/Dashboard';
import { Projects } from '@/pages/Projects';
import { Personas } from '@/pages/Personas';
import { TestStudio } from '@/pages/TestStudio';
import { NewTest } from '@/pages/NewTest';
import { TestResultsPage } from '@/pages/TestResults';

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
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
