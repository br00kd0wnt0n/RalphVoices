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
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [allTests, setAllTests] = useState<Test[]>([]);
  const [allPersonas, setAllPersonas] = useState<Persona[]>([]);
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
        setAllProjects(projectsData);
        setAllTests(testsData);
        setAllPersonas(personasData);
      } catch (error) {
        console.error('Failed to load dashboard data:', error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Deduplicate personas by name (same persona can exist across multiple projects)
  const uniquePersonaNames = new Set(allPersonas.map((p) => p.name));

  // Full counts for stats
  const stats = {
    projects: allProjects.length,
    personas: uniquePersonaNames.size,
    variants: allPersonas.reduce((sum, p) => sum + (Number(p.variant_count) || 0), 0),
    tests: allTests.length,
    completedTests: allTests.filter((t) => t.status === 'complete').length,
  };

  // Sliced for display
  const recentTests = allTests.slice(0, 5);

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
    <div className="space-y-12 max-w-5xl mx-auto">
      {/* Hero — Apple-style provocative statement */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
        className="relative pt-8 md:pt-16 pb-4 text-center"
      >
        {/* VOICES wordmark */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="mb-8"
        >
          <h1
            className="text-[4.5rem] md:text-[7rem] lg:text-[9rem] font-bold leading-none tracking-[-0.04em]"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            <span className="bg-gradient-to-r from-white via-white to-white/40 bg-clip-text text-transparent">
              V
            </span>
            <span className="bg-gradient-to-r from-[#D94D8F] to-[#D94D8F]/80 bg-clip-text text-transparent">
              O
            </span>
            <span className="bg-gradient-to-r from-white/90 to-white/60 bg-clip-text text-transparent">
              ICES
            </span>
          </h1>
          {/* Voice waveform animation */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="mx-auto mt-3 flex items-center justify-center gap-[3px] h-8"
          >
            {Array.from({ length: 24 }).map((_, i) => {
              // Create a wave pattern that oscillates
              const centerDistance = Math.abs(i - 11.5) / 11.5;
              const baseHeight = 0.15 + (1 - centerDistance) * 0.85;
              return (
                <motion.div
                  key={i}
                  className="w-[2px] rounded-full bg-[#D94D8F]"
                  initial={{ height: 2, opacity: 0 }}
                  animate={{
                    height: [
                      baseHeight * 4,
                      baseHeight * 28,
                      baseHeight * 8,
                      baseHeight * 22,
                      baseHeight * 4,
                    ],
                    opacity: [0.3, 0.8, 0.4, 0.7, 0.3],
                  }}
                  transition={{
                    duration: 2.5 + Math.random() * 1.5,
                    delay: 0.6 + i * 0.04,
                    repeat: Infinity,
                    repeatType: 'reverse',
                    ease: 'easeInOut',
                  }}
                />
              );
            })}
          </motion.div>
        </motion.div>

        {/* Provocative statement */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="max-w-3xl mx-auto mb-10"
        >
          <p className="text-2xl md:text-3xl lg:text-4xl font-light text-white/90 leading-snug tracking-tight mb-4">
            You're spending $$$ on creative
            <br />
            <span className="text-white/40">your audience hasn't seen yet.</span>
          </p>
          <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
            Test any concept against AI-powered audience panels in 60 seconds.
            Real reactions. Before the real spend.
          </p>
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="flex items-center justify-center gap-4"
        >
          <Link to="/tests/new">
            <Button
              size="lg"
              className="bg-[#D94D8F] hover:bg-[#D94D8F]/90 text-white gap-2.5 text-base px-10 h-14 rounded-2xl shadow-lg shadow-[#D94D8F]/25 transition-all hover:shadow-xl hover:shadow-[#D94D8F]/35 hover:scale-[1.02] active:scale-[0.98]"
            >
              <Sparkles className="h-5 w-5" />
              Test a Concept
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          {gwiEnabled && (
            <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
              <GwiBadge />
              <span>Market data enriched</span>
            </div>
          )}
        </motion.div>

        {/* Ambient glow */}
        <div className="absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-[#D94D8F]/[0.06] rounded-full blur-[120px] pointer-events-none" />
      </motion.div>

      {/* Stats Row */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.6 }}
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
        transition={{ duration: 0.4, delay: 0.7 }}
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
                transition={{ duration: 0.3, delay: 0.75 + i * 0.05 }}
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
