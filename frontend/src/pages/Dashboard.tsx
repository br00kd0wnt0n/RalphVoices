import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { projects, tests, personas } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Users, TestTube, FolderOpen, ArrowRight, Sparkles, BarChart3, ChevronRight, Zap, Target, Clock, TrendingUp } from 'lucide-react';
import type { Project, Test, Persona } from '@/types';

const WORKFLOW_STEPS = [
  {
    step: 1,
    title: 'Create a Project',
    description: 'Organize your work by client or campaign. Each project contains its own personas and tests.',
    icon: FolderOpen,
    link: '/projects',
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
  },
  {
    step: 2,
    title: 'Build Personas',
    description: 'Define your target audience profiles with demographics, psychographics, media habits, and cultural context.',
    icon: Users,
    link: '/personas',
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10',
  },
  {
    step: 3,
    title: 'Generate Variants',
    description: 'AI creates 20+ unique individuals from each persona — varying ages, attitudes, platforms, and voice styles.',
    icon: Sparkles,
    link: '/personas',
    color: 'text-[#D94D8F]',
    bgColor: 'bg-[#D94D8F]/10',
  },
  {
    step: 4,
    title: 'Run Concept Tests',
    description: 'Submit your creative concept and watch your synthetic panel react with authentic, in-character feedback.',
    icon: TestTube,
    link: '/tests/new',
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
  },
  {
    step: 5,
    title: 'Analyze Results',
    description: 'Review sentiment scores, engagement likelihood, key themes, and representative quotes from your audience.',
    icon: BarChart3,
    link: '/tests',
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
  },
];

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
    variants: recentPersonas.reduce((sum, p) => sum + (Number(p.variant_count) || 0), 0),
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

      {/* How It Works */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">How It Works</h2>
          <span className="text-sm text-muted-foreground">5 steps to audience insights</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {WORKFLOW_STEPS.map((item) => (
            <Link key={item.step} to={item.link} className="group">
              <Card className="h-full hover:border-[#D94D8F]/50 transition-all duration-300 hover:shadow-lg hover:shadow-[#D94D8F]/5">
                <CardContent className="pt-6 pb-4 px-4">
                  <div className="space-y-3">
                    {/* Step Number & Icon */}
                    <div className="flex items-center justify-between">
                      <div className={`p-2.5 rounded-xl ${item.bgColor}`}>
                        <item.icon className={`h-5 w-5 ${item.color}`} />
                      </div>
                      <span className="text-3xl font-bold text-muted-foreground/20 group-hover:text-muted-foreground/40 transition-colors">
                        {item.step}
                      </span>
                    </div>

                    {/* Title */}
                    <h3 className="font-semibold text-sm group-hover:text-[#D94D8F] transition-colors">
                      {item.title}
                    </h3>

                    {/* Description */}
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {item.description}
                    </p>

                    {/* Arrow indicator */}
                    <div className="flex items-center text-xs text-muted-foreground group-hover:text-[#D94D8F] transition-colors pt-1">
                      <span>Get started</span>
                      <ChevronRight className="h-3 w-3 ml-1 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {/* Connector line for desktop */}
        <div className="hidden md:block relative -mt-[140px] mx-auto w-[calc(100%-120px)] pointer-events-none">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500/20 via-[#D94D8F]/30 to-green-500/20" />
        </div>
        <div className="hidden md:block h-[100px]" /> {/* Spacer to account for negative margin */}
      </div>

      {/* Why Voices? */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Why Voices?</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-amber-500/5 to-transparent border-amber-500/20">
            <CardContent className="pt-6">
              <div className="space-y-3">
                <div className="p-2.5 rounded-xl bg-amber-500/10 w-fit">
                  <Clock className="h-5 w-5 text-amber-500" />
                </div>
                <h3 className="font-semibold">60-Second Feedback</h3>
                <p className="text-sm text-muted-foreground">
                  Traditional testing takes weeks. Get authentic reactions in under a minute, iterate faster.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-blue-500/5 to-transparent border-blue-500/20">
            <CardContent className="pt-6">
              <div className="space-y-3">
                <div className="p-2.5 rounded-xl bg-blue-500/10 w-fit">
                  <Target className="h-5 w-5 text-blue-500" />
                </div>
                <h3 className="font-semibold">Nuanced Reactions</h3>
                <p className="text-sm text-muted-foreground">
                  20+ unique voices per persona. See how skeptics differ from enthusiasts, TikTok from YouTube users.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-500/5 to-transparent border-green-500/20">
            <CardContent className="pt-6">
              <div className="space-y-3">
                <div className="p-2.5 rounded-xl bg-green-500/10 w-fit">
                  <TrendingUp className="h-5 w-5 text-green-500" />
                </div>
                <h3 className="font-semibold">Consistent Benchmarks</h3>
                <p className="text-sm text-muted-foreground">
                  Same panel across all tests. Compare Concept A vs B against identical audience segments.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-500/5 to-transparent border-purple-500/20">
            <CardContent className="pt-6">
              <div className="space-y-3">
                <div className="p-2.5 rounded-xl bg-purple-500/10 w-fit">
                  <Zap className="h-5 w-5 text-purple-500" />
                </div>
                <h3 className="font-semibold">Kill Bad Ideas Early</h3>
                <p className="text-sm text-muted-foreground">
                  Stress-test before production spend. Catch concerns, find angles, bring stronger concepts to real research.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="p-4 rounded-lg bg-muted/50 border border-dashed">
          <p className="text-sm text-muted-foreground text-center">
            <span className="font-medium text-foreground">Best for:</span> Rapid screening, early-stage iteration, comparing concepts, identifying unexpected concerns.
            <span className="mx-2">•</span>
            <span className="font-medium text-foreground">Not a replacement for:</span> Final-stage qual research with real consumers.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
            <CardTitle className="text-sm font-medium">Panel Size</CardTitle>
            <Sparkles className="h-4 w-4 text-[#D94D8F]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.variants}</div>
            <p className="text-xs text-muted-foreground">variants</p>
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
