import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { projects, tests, personas } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Users, TestTube, FolderOpen, ArrowRight } from 'lucide-react';
import type { Project, Test, Persona } from '@/types';

export function Dashboard() {
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [recentTests, setRecentTests] = useState<Test[]>([]);
  const [recentPersonas, setRecentPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [projectsData, testsData, personasData] = await Promise.all([
          projects.list(),
          tests.list(),
          personas.list(),
        ]);
        setRecentProjects(projectsData.slice(0, 5));
        setRecentTests(testsData.slice(0, 5));
        setRecentPersonas(personasData.slice(0, 5));
      } catch (error) {
        console.error('Failed to load dashboard data:', error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const stats = {
    projects: recentProjects.length,
    personas: recentPersonas.length,
    tests: recentTests.length,
    completedTests: recentTests.filter((t) => t.status === 'complete').length,
  };

  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#D94D8F]/10 via-transparent to-transparent border border-[#D94D8F]/20 p-8">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold mb-3">Welcome to Voices</h1>
          <p className="text-lg text-foreground/80 mb-4">
            AI personas calibrated to your audience, stress-testing concepts before they reach the world.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Replaces gut-check with pattern recognition — revealing what resonates, what concerns, and where opportunities hide across a statistically meaningful synthetic cohort.
          </p>
        </div>
        <div className="absolute -right-20 -top-20 w-64 h-64 bg-[#D94D8F]/5 rounded-full blur-3xl" />
        <div className="absolute -right-10 -bottom-10 w-48 h-48 bg-[#D94D8F]/10 rounded-full blur-2xl" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Projects</CardTitle>
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.projects}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Personas</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.personas}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tests</CardTitle>
            <TestTube className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.tests}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <TestTube className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.completedTests}</div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link to="/personas">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full bg-primary/10">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Create Persona</h3>
                  <p className="text-sm text-muted-foreground">
                    Build a new synthetic persona
                  </p>
                </div>
                <ArrowRight className="h-5 w-5 ml-auto text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link to="/tests/new">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full bg-primary/10">
                  <TestTube className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Run Test</h3>
                  <p className="text-sm text-muted-foreground">
                    Test a concept with your panel
                  </p>
                </div>
                <ArrowRight className="h-5 w-5 ml-auto text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link to="/projects">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full bg-primary/10">
                  <FolderOpen className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">New Project</h3>
                  <p className="text-sm text-muted-foreground">
                    Organize your work by client
                  </p>
                </div>
                <ArrowRight className="h-5 w-5 ml-auto text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Recent Tests */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent Tests</CardTitle>
          <Link to="/tests">
            <Button variant="ghost" size="sm">
              View All <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {recentTests.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              No tests yet. Run your first concept test!
            </p>
          ) : (
            <div className="space-y-3">
              {recentTests.map((test) => (
                <Link
                  key={test.id}
                  to={`/tests/${test.id}`}
                  className="flex items-center justify-between p-3 rounded-md hover:bg-accent"
                >
                  <div>
                    <p className="font-medium">{test.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(test.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge
                    variant={
                      test.status === 'complete'
                        ? 'success'
                        : test.status === 'running'
                        ? 'warning'
                        : test.status === 'failed'
                        ? 'destructive'
                        : 'secondary'
                    }
                  >
                    {test.status}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
