import { useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';

interface BootStep {
  id: string;
  label: string;
  status: 'pending' | 'loading' | 'success' | 'error';
  detail?: string;
}

interface BootSequenceProps {
  onComplete: () => void;
}

export function BootSequence({ onComplete }: BootSequenceProps) {
  const [steps, setSteps] = useState<BootStep[]>([
    { id: 'api', label: 'Connecting to API', status: 'pending' },
    { id: 'auth', label: 'Verifying session', status: 'pending' },
    { id: 'projects', label: 'Loading projects', status: 'pending' },
    { id: 'personas', label: 'Loading personas', status: 'pending' },
    { id: 'tests', label: 'Loading tests', status: 'pending' },
  ]);

  const updateStep = (id: string, updates: Partial<BootStep>) => {
    setSteps(prev => prev.map(step =>
      step.id === id ? { ...step, ...updates } : step
    ));
  };

  useEffect(() => {
    async function runBootSequence() {
      const token = localStorage.getItem('token');
      const API_BASE = import.meta.env.VITE_API_URL || '/api';

      // Step 1: Connect to API
      updateStep('api', { status: 'loading' });
      try {
        const healthRes = await fetch(API_BASE.replace('/api', '/health'));
        if (healthRes.ok) {
          updateStep('api', { status: 'success', detail: 'Connected' });
        } else {
          throw new Error('API unavailable');
        }
      } catch {
        updateStep('api', { status: 'error', detail: 'Connection failed' });
        return;
      }

      await sleep(300);

      // Step 2: Verify auth
      updateStep('auth', { status: 'loading' });
      try {
        const authRes = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (authRes.ok) {
          const data = await authRes.json();
          updateStep('auth', { status: 'success', detail: data.user?.email || 'Verified' });
        } else {
          throw new Error('Auth failed');
        }
      } catch {
        updateStep('auth', { status: 'error', detail: 'Session invalid' });
        return;
      }

      await sleep(300);

      // Step 3: Load projects
      updateStep('projects', { status: 'loading' });
      try {
        const projectsRes = await fetch(`${API_BASE}/projects`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (projectsRes.ok) {
          const projects = await projectsRes.json();
          updateStep('projects', { status: 'success', detail: `${projects.length} projects` });
        } else {
          throw new Error('Failed to load');
        }
      } catch {
        updateStep('projects', { status: 'error', detail: 'Load failed' });
      }

      await sleep(300);

      // Step 4: Load personas
      updateStep('personas', { status: 'loading' });
      try {
        const personasRes = await fetch(`${API_BASE}/personas`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (personasRes.ok) {
          const personas = await personasRes.json();
          updateStep('personas', { status: 'success', detail: `${personas.length} personas` });
        } else {
          throw new Error('Failed to load');
        }
      } catch {
        updateStep('personas', { status: 'error', detail: 'Load failed' });
      }

      await sleep(300);

      // Step 5: Load tests
      updateStep('tests', { status: 'loading' });
      try {
        const testsRes = await fetch(`${API_BASE}/tests`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (testsRes.ok) {
          const tests = await testsRes.json();
          updateStep('tests', { status: 'success', detail: `${tests.length} tests` });
        } else {
          throw new Error('Failed to load');
        }
      } catch {
        updateStep('tests', { status: 'error', detail: 'Load failed' });
      }

      await sleep(500);
      onComplete();
    }

    runBootSequence();
  }, [onComplete]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">Ralph Voices</h1>
          <p className="text-muted-foreground text-sm">Initializing system...</p>
        </div>

        <div className="space-y-3">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-all duration-300 ${
                step.status === 'pending'
                  ? 'border-border/50 opacity-50'
                  : step.status === 'loading'
                  ? 'border-[#D94D8F]/50 bg-[#D94D8F]/5'
                  : step.status === 'success'
                  ? 'border-green-500/30 bg-green-500/5'
                  : 'border-red-500/30 bg-red-500/5'
              }`}
              style={{
                animationDelay: `${index * 100}ms`,
              }}
            >
              <div className="w-6 h-6 flex items-center justify-center">
                {step.status === 'pending' && (
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/50" />
                )}
                {step.status === 'loading' && (
                  <Loader2 className="w-5 h-5 text-[#D94D8F] animate-spin" />
                )}
                {step.status === 'success' && (
                  <Check className="w-5 h-5 text-green-500" />
                )}
                {step.status === 'error' && (
                  <X className="w-5 h-5 text-red-500" />
                )}
              </div>
              <div className="flex-1">
                <p className={`text-sm font-medium ${
                  step.status === 'pending' ? 'text-muted-foreground' : 'text-foreground'
                }`}>
                  {step.label}
                </p>
              </div>
              {step.detail && (
                <span className={`text-xs ${
                  step.status === 'success' ? 'text-green-500' :
                  step.status === 'error' ? 'text-red-500' : 'text-muted-foreground'
                }`}>
                  {step.detail}
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="mt-8 flex justify-center">
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-2 h-2 rounded-full bg-[#D94D8F]/60 animate-pulse"
                style={{ animationDelay: `${i * 200}ms` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
