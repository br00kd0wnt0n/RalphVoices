import { useState, useEffect, useCallback } from 'react';
import { admin as adminApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Shield,
  Database,
  Users,
  Anchor,
  RefreshCw,
  Trash2,
  CheckCircle,
  XCircle,
  Cpu,
  Layers,
  Target,
  Compass,
  Palette,
  Globe,
  AlertTriangle,
} from 'lucide-react';
import { motion } from 'framer-motion';

type AnchorStats = {
  total_anchors: number;
  by_source: Record<string, number>;
  embedded_personas: number;
  total_personas: number;
};

type PersonaStatus = {
  id: string;
  name: string;
  age_base: number | null;
  location: string | null;
  has_values: boolean;
  has_platform: boolean;
  has_cultural: boolean;
  has_demographic: boolean;
  embeddings_updated_at: string | null;
};

type RecentAnchor = {
  id: string;
  source: string;
  confidence: number;
  sentiment_score: number;
  engagement_likelihood: number;
  share_likelihood: number;
  comprehension_score: number;
  reaction_tags: string[];
  primary_platform: string | null;
  attitude_score: number | null;
  persona_name: string | null;
  test_name: string | null;
  created_at: string;
};

function scoreColor(score: number): string {
  if (score >= 7) return 'text-green-600';
  if (score >= 4) return 'text-yellow-600';
  return 'text-red-600';
}

function scoreBg(score: number): string {
  if (score >= 7) return 'bg-green-50';
  if (score >= 4) return 'bg-yellow-50';
  return 'bg-red-50';
}

export function Admin() {
  const [stats, setStats] = useState<AnchorStats | null>(null);
  const [personas, setPersonas] = useState<PersonaStatus[]>([]);
  const [anchors, setAnchors] = useState<RecentAnchor[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [seedResult, setSeedResult] = useState<{ anchors_seeded: number; personas_embedded: number } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, a] = await Promise.all([
        adminApi.stats(),
        adminApi.personas(),
        adminApi.recent(),
      ]);
      setStats(s);
      setPersonas(p);
      setAnchors(a);
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleSeed() {
    setSeeding(true);
    setSeedResult(null);
    try {
      const result = await adminApi.seed();
      setSeedResult(result);
      await loadData();
    } catch (err) {
      console.error('Seed failed:', err);
    } finally {
      setSeeding(false);
    }
  }

  async function handleClear() {
    setClearing(true);
    try {
      await adminApi.clear();
      setConfirmClear(false);
      await loadData();
    } catch (err) {
      console.error('Clear failed:', err);
    } finally {
      setClearing(false);
    }
  }

  const embeddedCount = personas.filter(
    (p) => p.has_values && p.has_platform && p.has_cultural && p.has_demographic
  ).length;

  const ALGORITHM_CONSTANTS = [
    { label: 'Embedding Model', value: 'text-embedding-3-small', icon: Cpu },
    { label: 'Vector Dimensions', value: '1,536', icon: Layers },
    { label: 'Nearest Anchors (K)', value: '10', icon: Target },
    { label: 'Min Similarity', value: '0.50', icon: Compass },
    { label: 'Score Range', value: '±1.5', icon: Target },
    { label: 'Min Anchors for Constraint', value: '3', icon: Anchor },
  ];

  const FACETS = [
    { name: 'Values', desc: 'Psychographics: values, motivations, aspirations, pain points, decision style', color: 'bg-pink-100 text-pink-700 border-pink-200', icon: Palette },
    { name: 'Platform', desc: 'Media habits: platforms, content preferences, influencer affinities', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: Globe },
    { name: 'Cultural', desc: 'Cultural context: subcultures, humor style, language markers', color: 'bg-purple-100 text-purple-700 border-purple-200', icon: Compass },
    { name: 'Demographic', desc: 'Identity: age, location, occupation, household, brand context', color: 'bg-amber-100 text-amber-700 border-amber-200', icon: Users },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Shield className="h-8 w-8 text-[#D94D8F]" />
              Admin
            </h1>
            <p className="text-muted-foreground mt-1">
              Vector scoring engine internals and management
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </motion.div>

      <Tabs defaultValue="overview">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="personas">Personas</TabsTrigger>
          <TabsTrigger value="anchors">Anchors</TabsTrigger>
        </TabsList>

        {/* === OVERVIEW TAB === */}
        <TabsContent value="overview" className="space-y-6 mt-4">
          {/* Stats Row */}
          <div className="grid grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-3xl font-bold text-[#D94D8F]">
                  {stats?.total_anchors ?? '—'}
                </div>
                <p className="text-sm text-muted-foreground mt-1">Reference Anchors</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-3xl font-bold text-indigo-600">
                  {stats ? `${stats.embedded_personas}/${stats.total_personas}` : '—'}
                </div>
                <p className="text-sm text-muted-foreground mt-1">Personas Embedded</p>
                {stats && stats.total_personas > 0 && (
                  <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-600 rounded-full transition-all"
                      style={{ width: `${(stats.embedded_personas / stats.total_personas) * 100}%` }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-3xl font-bold text-emerald-600">4</div>
                <p className="text-sm text-muted-foreground mt-1">Embedding Facets</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-3xl font-bold text-amber-600">1,536</div>
                <p className="text-sm text-muted-foreground mt-1">Vector Dimensions</p>
              </CardContent>
            </Card>
          </div>

          {/* Source Breakdown */}
          {stats && Object.keys(stats.by_source).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Anchors by Source
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-3">
                  {Object.entries(stats.by_source).map(([source, count]) => (
                    <div key={source} className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg">
                      <Badge variant="secondary">{source}</Badge>
                      <span className="text-sm font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Algorithm Constants */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Cpu className="h-4 w-4" />
                Scoring Algorithm Parameters
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3">
                {ALGORITHM_CONSTANTS.map((c) => {
                  const Icon = c.icon;
                  return (
                    <div key={c.label} className="flex items-center gap-3 p-3 rounded-lg border border-border/50">
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">{c.label}</p>
                        <p className="text-sm font-mono font-medium">{c.value}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* 4-Facet Embedding Model */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Multi-Facet Persona Embedding
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {FACETS.map((f) => {
                  const Icon = f.icon;
                  return (
                    <div key={f.name} className={`p-3 rounded-lg border ${f.color}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className="h-4 w-4" />
                        <span className="font-medium text-sm">vec_{f.name.toLowerCase()}</span>
                      </div>
                      <p className="text-xs opacity-80">{f.desc}</p>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Each persona is embedded into 4 separate vectors (1,536 dims each). Concept similarity is computed against all facets with weighted combination: values (35%) + platform (25%) + cultural (25%) + demographic (15%).
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* === PERSONAS TAB === */}
        <TabsContent value="personas" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {embeddedCount} of {personas.length} personas fully embedded
            </p>
            <Button variant="outline" size="sm" onClick={handleSeed} disabled={seeding}>
              <RefreshCw className={`h-4 w-4 mr-2 ${seeding ? 'animate-spin' : ''}`} />
              {seeding ? 'Backfilling...' : 'Backfill Embeddings'}
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 font-medium">Persona</th>
                      <th className="text-left p-3 font-medium">Age</th>
                      <th className="text-left p-3 font-medium">Location</th>
                      <th className="text-center p-3 font-medium">
                        <span className="text-pink-600">Values</span>
                      </th>
                      <th className="text-center p-3 font-medium">
                        <span className="text-blue-600">Platform</span>
                      </th>
                      <th className="text-center p-3 font-medium">
                        <span className="text-purple-600">Cultural</span>
                      </th>
                      <th className="text-center p-3 font-medium">
                        <span className="text-amber-600">Demo</span>
                      </th>
                      <th className="text-left p-3 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {personas.map((p) => (
                      <tr key={p.id} className="border-b border-border/30 hover:bg-muted/30">
                        <td className="p-3 font-medium">{p.name}</td>
                        <td className="p-3 text-muted-foreground">{p.age_base ?? '—'}</td>
                        <td className="p-3 text-muted-foreground">{p.location ?? '—'}</td>
                        <td className="p-3 text-center">
                          {p.has_values ? (
                            <CheckCircle className="h-4 w-4 text-green-600 mx-auto" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-400 mx-auto" />
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {p.has_platform ? (
                            <CheckCircle className="h-4 w-4 text-green-600 mx-auto" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-400 mx-auto" />
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {p.has_cultural ? (
                            <CheckCircle className="h-4 w-4 text-green-600 mx-auto" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-400 mx-auto" />
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {p.has_demographic ? (
                            <CheckCircle className="h-4 w-4 text-green-600 mx-auto" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-400 mx-auto" />
                          )}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {p.embeddings_updated_at
                            ? new Date(p.embeddings_updated_at).toLocaleDateString()
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* === ANCHORS TAB === */}
        <TabsContent value="anchors" className="space-y-4 mt-4">
          {/* Actions */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {anchors.length} most recent anchors
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleSeed} disabled={seeding}>
                <RefreshCw className={`h-4 w-4 mr-2 ${seeding ? 'animate-spin' : ''}`} />
                {seeding ? 'Seeding...' : 'Seed from History'}
              </Button>
              {!confirmClear ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => setConfirmClear(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear All
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-600 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> This deletes all anchors
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleClear}
                    disabled={clearing}
                  >
                    {clearing ? 'Clearing...' : 'Confirm'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmClear(false)}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </div>

          {seedResult && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm">
              <CheckCircle className="h-4 w-4 text-emerald-600" />
              <span>
                Seeded <strong>{seedResult.anchors_seeded}</strong> anchors, embedded{' '}
                <strong>{seedResult.personas_embedded}</strong> personas
              </span>
            </div>
          )}

          {/* Anchors Table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 font-medium">Persona</th>
                      <th className="text-left p-3 font-medium">Test</th>
                      <th className="text-center p-3 font-medium">Sent</th>
                      <th className="text-center p-3 font-medium">Eng</th>
                      <th className="text-center p-3 font-medium">Share</th>
                      <th className="text-center p-3 font-medium">Comp</th>
                      <th className="text-left p-3 font-medium">Platform</th>
                      <th className="text-left p-3 font-medium">Source</th>
                      <th className="text-left p-3 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {anchors.map((a) => (
                      <tr key={a.id} className="border-b border-border/30 hover:bg-muted/30">
                        <td className="p-3 font-medium">{a.persona_name ?? '—'}</td>
                        <td className="p-3 text-muted-foreground max-w-[150px] truncate">
                          {a.test_name ?? '—'}
                        </td>
                        <td className={`p-3 text-center font-mono font-medium ${scoreColor(a.sentiment_score)} ${scoreBg(a.sentiment_score)}`}>
                          {a.sentiment_score}
                        </td>
                        <td className={`p-3 text-center font-mono font-medium ${scoreColor(a.engagement_likelihood)} ${scoreBg(a.engagement_likelihood)}`}>
                          {a.engagement_likelihood}
                        </td>
                        <td className={`p-3 text-center font-mono font-medium ${scoreColor(a.share_likelihood)} ${scoreBg(a.share_likelihood)}`}>
                          {a.share_likelihood}
                        </td>
                        <td className={`p-3 text-center font-mono font-medium ${scoreColor(a.comprehension_score)} ${scoreBg(a.comprehension_score)}`}>
                          {a.comprehension_score}
                        </td>
                        <td className="p-3">
                          {a.primary_platform && (
                            <Badge variant="secondary" className="text-xs">
                              {a.primary_platform}
                            </Badge>
                          )}
                        </td>
                        <td className="p-3">
                          <Badge variant="outline" className="text-xs">
                            {a.source}
                          </Badge>
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {new Date(a.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                    {anchors.length === 0 && (
                      <tr>
                        <td colSpan={9} className="p-8 text-center text-muted-foreground">
                          No anchors yet. Run a test or seed from history.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
