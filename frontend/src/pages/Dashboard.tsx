import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { projects, tests, personas } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, Sparkles, TestTube, Users, FolderOpen, BarChart3 } from 'lucide-react';
import { motion } from 'framer-motion';
import type { Project, Test, Persona } from '@/types';
import { useGwi } from '@/hooks/useGwi';
import { GwiBadge } from '@/components/GwiBadge';

export function Dashboard() {
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [recentTests, setRecentTests] = useState<Test[]>([]);
  const [recentPersonas, setRecentPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const { enabled: gwiEnabled } = useGwi();

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
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-xl bg-muted/50 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Hero CTA */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#D94D8F]/10 via-[#D94D8F]/5 to-transparent border border-[#D94D8F]/20 p-8 md:p-12"
      >
        <div className="relative z-10 max-w-2xl">
          <div className="flex items-center gap-3 mb-4">
            <h1 className="text-4xl font-bold tracking-tight">Test a concept</h1>
            {gwiEnabled && <GwiBadge />}
          </div>
          <p className="text-lg text-muted-foreground mb-6 leading-relaxed">
            Describe your idea, choose an audience, and get feedback from an AI panel in under 60 seconds.
          </p>
          <Link to="/tests/new">
            <Button size="lg" className="bg-[#D94D8F] hover:bg-[#D94D8F]/90 text-white gap-2 text-base px-8 h-12 rounded-xl shadow-lg shadow-[#D94D8F]/20 transition-all hover:shadow-xl hover:shadow-[#D94D8F]/30 hover:scale-[1.02]">
              <Sparkles className="h-5 w-5" />
              Start New Test
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
        <div className="absolute -right-20 -top-20 w-80 h-80 bg-[#D94D8F]/5 rounded-full blur-3xl" />
        <div className="absolute -right-10 -bottom-10 w-60 h-60 bg-[#D94D8F]/8 rounded-full blur-2xl" />
      </motion.div>

      {/* Stats Row */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.15 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-3"
      >
        {[
          { label: 'Projects', value: stats.projects, icon: FolderOpen, color: 'text-blue-500' },
          { label: 'Personas', value: stats.personas, icon: Users, color: 'text-purple-500' },
          { label: 'Panel Size', value: stats.variants, icon: Sparkles, color: 'text-[#D94D8F]', sub: 'variants' },
          { label: 'Tests Run', value: stats.completedTests, icon: BarChart3, color: 'text-emerald-500' },
        ].map((stat) => (
          <Card key={stat.label} className="border-border/50">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
                <span className="text-sm text-muted-foreground">{stat.label}</span>
              </div>
              <p className="text-3xl font-bold mt-1">{stat.value}</p>
              {stat.sub && <p className="text-xs text-muted-foreground">{stat.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </motion.div>

      {/* Recent Tests */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.25 }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Recent Tests</h2>
          {recentTests.length > 0 && (
            <Link to="/tests">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground gap-1">
                View All <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
          )}
        </div>

        {recentTests.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <TestTube className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-muted-foreground mb-4">No tests yet. Run your first concept test!</p>
              <Link to="/tests/new">
                <Button variant="outline" className="gap-2">
                  <Sparkles className="h-4 w-4" />
                  Create Your First Test
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {recentTests.map((test, i) => (
              <motion.div
                key={test.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 0.3 + i * 0.05 }}
              >
                <Link
                  to={`/tests/${test.id}`}
                  className="flex items-center justify-between p-4 rounded-xl border border-border/50 hover:border-[#D94D8F]/30 hover:bg-[#D94D8F]/[0.02] transition-all group"
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-2 h-2 rounded-full ${
                      test.status === 'complete' ? 'bg-emerald-500'
                      : test.status === 'running' ? 'bg-amber-500 animate-pulse'
                      : test.status === 'failed' ? 'bg-red-500'
                      : 'bg-muted-foreground/30'
                    }`} />
                    <div>
                      <p className="font-medium group-hover:text-[#D94D8F] transition-colors">{test.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(test.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={
                        test.status === 'complete' ? 'success'
                        : test.status === 'running' ? 'warning'
                        : test.status === 'failed' ? 'destructive'
                        : 'secondary'
                      }
                      className="capitalize"
                    >
                      {test.status}
                    </Badge>
                    <ArrowRight className="h-4 w-4 text-muted-foreground/0 group-hover:text-[#D94D8F] transition-all group-hover:translate-x-1" />
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
