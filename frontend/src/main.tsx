import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from '@/hooks/useAuth';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
// rebuild 1737063600 - ws fix
// deploy 1768604222
