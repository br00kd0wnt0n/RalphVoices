import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { RalphLogo } from '@/components/RalphLogo';
import { auth } from '@/lib/api';

export function Login() {
  const { login, register, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Production closes password auth: people sign in through tools.ralph.world
  // (Google), and only allowlisted service accounts use the form below.
  const [authConfig, setAuthConfig] = useState<{ password_auth: 'open' | 'closed'; sign_in_url: string } | null>(null);
  const [showServiceSignIn, setShowServiceSignIn] = useState(false);

  useEffect(() => {
    auth.config().then(setAuthConfig).catch(() => setAuthConfig({ password_auth: 'closed', sign_in_url: 'https://tools.ralph.world/voices' }));
  }, []);
  const passwordOpen = authConfig?.password_auth === 'open';
  const showForm = passwordOpen || showServiceSignIn;

  // After login/register succeeds, the AuthProvider sets `user`; redirect to
  // the page the route guard captured (or "/" if the user came directly).
  useEffect(() => {
    if (user) {
      const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/';
      navigate(from, { replace: true });
    }
  }, [user, navigate, location.state]);

  // If somehow rendered while already authed, bail out immediately.
  if (user) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegister) {
        await register(email, password, name);
      } else {
        await login(email, password);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="text-center flex flex-col items-center">
          <RalphLogo size="lg" />
          <p className="text-muted-foreground text-sm mt-2">
            Synthetic audience panel testing
          </p>
        </div>

        <Card className="border-border/50">
          <CardHeader className="text-center pb-4">
            <CardDescription className="text-base">
              {isRegister ? 'Create your account' : 'Sign in to continue'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!passwordOpen && authConfig && (
              <div className="space-y-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Voices is part of Ralph Tools. Sign in there with your Ralph Google account.
                </p>
                <Button asChild className="w-full bg-[#D94D8F] hover:bg-[#C43D7F] glow-sm">
                  <a href={authConfig.sign_in_url} target="_top">Open Ralph Tools</a>
                </Button>
                {!showServiceSignIn && (
                  <button
                    type="button"
                    onClick={() => setShowServiceSignIn(true)}
                    className="text-xs text-muted-foreground hover:text-[#D94D8F] transition-colors"
                  >
                    Service account sign-in
                  </button>
                )}
              </div>
            )}
            {showForm && (
            <form onSubmit={handleSubmit} className={`space-y-4 ${passwordOpen ? '' : 'mt-6'}`}>
              {isRegister && (
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="bg-background/50"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="bg-background/50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="bg-background/50"
                />
              </div>
              {error && (
                <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>
              )}
              <Button type="submit" className="w-full bg-[#D94D8F] hover:bg-[#C43D7F] glow-sm" disabled={loading}>
                {loading ? 'Loading...' : isRegister ? 'Create Account' : 'Sign In'}
              </Button>
            </form>
            )}
            {passwordOpen && (
              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={() => setIsRegister(!isRegister)}
                  className="text-sm text-muted-foreground hover:text-[#D94D8F] transition-colors"
                >
                  {isRegister ? 'Already have an account? Sign in' : "Don't have an account? Register"}
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
