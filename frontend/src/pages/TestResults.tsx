import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { tests as testsApi, gwi as gwiApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { ArrowLeft, RefreshCw, Users, TrendingUp, MessageSquare, AlertTriangle, Sparkles, Globe, Download, Lightbulb, ShieldAlert, FileText, Pencil } from 'lucide-react';
import type { Test, TestResponse } from '@/types';
import { SENTIMENT_THRESHOLDS } from '@/lib/constants';
import { GwiBadge } from '@/components/GwiBadge';
import { EmotionalSpectrum } from '@/components/EmotionalSpectrum';
import { BrainBalance } from '@/components/BrainBalance';
import { KeyAssociations } from '@/components/KeyAssociations';
import { ShareabilityAnalysis } from '@/components/ShareabilityAnalysis';
import { TestComparison } from '@/components/TestComparison';
import { GwiRecommendations } from '@/components/GwiRecommendations';
import { InsightsChat } from '@/components/InsightsChat';

const COLORS = {
  positive: '#22c55e',
  neutral: '#eab308',
  negative: '#ef4444',
};

// Calculate RalphScore™ - proprietary benchmark score (0-100)
function calculateRalphScore(summary: {
  sentiment: { positive: number; neutral: number; negative: number };
  avg_engagement: number;
  avg_share_likelihood: number;
  avg_comprehension: number;
  total_responses: number;
}): number {
  const total = summary.sentiment.positive + summary.sentiment.neutral + summary.sentiment.negative;
  if (total === 0) return 0;

  // Calculate sentiment score (weighted average: positive=10, neutral=5, negative=1)
  const sentimentScore = (
    (summary.sentiment.positive * 10) +
    (summary.sentiment.neutral * 5) +
    (summary.sentiment.negative * 1)
  ) / total;

  // Base score from metrics (all out of 10, weighted)
  const baseScore = (
    (sentimentScore * 0.30) +           // 30% sentiment
    (summary.avg_engagement * 0.30) +    // 30% engagement
    (summary.avg_share_likelihood * 0.25) + // 25% share likelihood
    (summary.avg_comprehension * 0.15)   // 15% comprehension
  );

  // Sentiment distribution modifier
  const positiveRatio = summary.sentiment.positive / total;
  const negativeRatio = summary.sentiment.negative / total;
  const distributionModifier = 1 + (positiveRatio * 0.1) - (negativeRatio * 0.15);

  // Calculate final score (0-100)
  const ralphScore = Math.round(baseScore * 10 * distributionModifier);

  // Clamp between 0-100
  return Math.max(0, Math.min(100, ralphScore));
}

// Get RalphScore rating label
function getRalphScoreLabel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: 'Excellent', color: 'text-green-500' };
  if (score >= 65) return { label: 'Strong', color: 'text-emerald-500' };
  if (score >= 50) return { label: 'Promising', color: 'text-yellow-500' };
  if (score >= 35) return { label: 'Needs Work', color: 'text-orange-500' };
  return { label: 'Reconsider', color: 'text-red-500' };
}

// Calculate live stats from responses
function calculateLiveStats(responses: TestResponse[]) {
  if (responses.length === 0) {
    return null;
  }

  const sentimentCounts = {
    positive: responses.filter(r => (r.sentiment_score ?? 5) >= SENTIMENT_THRESHOLDS.POSITIVE_MIN).length,
    neutral: responses.filter(r => (r.sentiment_score ?? 5) >= SENTIMENT_THRESHOLDS.NEUTRAL_MIN && (r.sentiment_score ?? 5) < SENTIMENT_THRESHOLDS.POSITIVE_MIN).length,
    negative: responses.filter(r => (r.sentiment_score ?? 5) < SENTIMENT_THRESHOLDS.NEUTRAL_MIN).length,
  };

  const avgEngagement = responses.reduce((sum, r) => sum + (r.engagement_likelihood || 5), 0) / responses.length;
  const avgShare = responses.reduce((sum, r) => sum + (r.share_likelihood || 5), 0) / responses.length;
  const avgComprehension = responses.reduce((sum, r) => sum + (r.comprehension_score || 5), 0) / responses.length;

  // Calculate by platform
  const byPlatform: Record<string, { count: number; avgSentiment: number; avgEngagement: number }> = {};
  for (const r of responses) {
    const platform = r.primary_platform || 'Other';
    if (!byPlatform[platform]) {
      byPlatform[platform] = { count: 0, avgSentiment: 0, avgEngagement: 0 };
    }
    byPlatform[platform].count++;
    byPlatform[platform].avgSentiment += r.sentiment_score || 5;
    byPlatform[platform].avgEngagement += r.engagement_likelihood || 5;
  }
  for (const group of Object.values(byPlatform)) {
    group.avgSentiment = Math.round((group.avgSentiment / group.count) * 10) / 10;
    group.avgEngagement = Math.round((group.avgEngagement / group.count) * 10) / 10;
  }

  return {
    summary: {
      total_responses: responses.length,
      sentiment: sentimentCounts,
      avg_engagement: Math.round(avgEngagement * 10) / 10,
      avg_share_likelihood: Math.round(avgShare * 10) / 10,
      avg_comprehension: Math.round(avgComprehension * 10) / 10,
    },
    segments: {
      by_platform: byPlatform,
    },
  };
}

export function TestResultsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [test, setTest] = useState<Test | null>(null);
  const [responses, setResponses] = useState<TestResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setWsConnected] = useState(false);

  // Filters
  const [sentimentFilter, setSentimentFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');

  useEffect(() => {
    loadTest();
  }, [id]);

  useEffect(() => {
    if (test?.status === 'running') {
      // Connect to WebSocket for progress updates
      // Get backend URL from API_URL env var or fall back to current host
      const apiUrl = import.meta.env.VITE_API_URL || '';
      let wsUrl: string;

      if (apiUrl && apiUrl.startsWith('http')) {
        // Convert API URL to WebSocket URL (e.g., https://backend.../api -> wss://backend.../ws/tests/...)
        const backendUrl = apiUrl.replace(/\/api$/, '').replace(/^http/, 'ws');
        wsUrl = `${backendUrl}/ws/tests/${id}/progress`;
      } else {
        // Fallback to same host (for local development)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${protocol}//${window.location.host}/ws/tests/${id}/progress`;
      }

      console.log('[TestResults] VITE_API_URL:', apiUrl);
      console.log('[TestResults] WebSocket URL:', wsUrl);

      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setWsConnected(true);
        console.log('[TestResults] WebSocket connected');
      };
      ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        console.log('[TestResults] WebSocket progress:', data);
        // Map WebSocket fields to test object fields
        setTest((prev) => prev ? {
          ...prev,
          status: data.status,
          responses_completed: data.completed,
          responses_total: data.total,
        } : null);

        // Fetch responses in real-time to show live dashboard
        if (data.completed > 0) {
          try {
            const responsesData = await testsApi.getResponses(id!, { limit: 100 });
            setResponses(responsesData.responses);
          } catch (err) {
            console.error('[TestResults] Failed to fetch live responses:', err);
          }
        }

        if (data.status === 'complete') {
          loadTest();
        }
      };
      ws.onclose = () => setWsConnected(false);
      ws.onerror = () => setWsConnected(false);

      return () => ws.close();
    }
  }, [test?.status, id]);

  async function loadTest() {
    try {
      const testData = await testsApi.get(id!);
      setTest(testData);

      if (testData.status === 'complete') {
        const responsesData = await testsApi.getResponses(id!, { limit: 100 });
        setResponses(responsesData.responses);
      }
    } catch (error) {
      console.error('Failed to load test:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  if (!test) {
    return <div className="text-center py-8">Test not found</div>;
  }

  const results = test.results;
  const progressPercent = test.responses_total > 0
    ? (test.responses_completed / test.responses_total) * 100
    : 0;

  // Filter responses
  const filteredResponses = responses.filter((r) => {
    if (sentimentFilter !== 'all') {
      const score = r.sentiment_score || 5;
      if (sentimentFilter === 'positive' && score < SENTIMENT_THRESHOLDS.POSITIVE_MIN) return false;
      if (sentimentFilter === 'neutral' && (score < SENTIMENT_THRESHOLDS.NEUTRAL_MIN || score >= SENTIMENT_THRESHOLDS.POSITIVE_MIN)) return false;
      if (sentimentFilter === 'negative' && score >= SENTIMENT_THRESHOLDS.NEUTRAL_MIN) return false;
    }
    if (platformFilter !== 'all' && r.primary_platform !== platformFilter) {
      return false;
    }
    return true;
  });

  // Get unique platforms for filter
  const platforms = [...new Set(responses.map((r) => r.primary_platform).filter(Boolean))];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            to="/tests"
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Tests
          </Link>
          <h1 className="text-3xl font-bold">{test.name}</h1>
          <div className="flex items-center gap-2 mt-1">
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
            <span className="text-sm text-muted-foreground">
              {new Date(test.created_at).toLocaleString()}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {test.status === 'running' && (
            <Button variant="outline" onClick={loadTest}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          )}
          {test.status === 'failed' && (
            <>
              <Button
                variant="outline"
                className="border-destructive/50 text-destructive hover:bg-destructive/10"
                onClick={async () => {
                  try {
                    await testsApi.run(test.id);
                    loadTest();
                  } catch (err: any) {
                    console.error('Failed to retry test:', err);
                  }
                }}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Quick Retry
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate(`/tests/new?retry=${test.id}`)}
              >
                <Pencil className="h-4 w-4 mr-2" />
                Edit & Retry
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Concept Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">Concept Tested</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap">{test.concept_text}</p>
          {(() => {
            const opts = typeof test.options === 'string' ? JSON.parse(test.options) : (test.options || {});
            const testAssets = opts.assets || [];
            const imageAssets = testAssets.filter((a: any) => a.isImage && a.base64);
            const pdfAssets = testAssets.filter((a: any) => a.isPDF);
            if (imageAssets.length === 0 && pdfAssets.length === 0) return null;
            return (
              <div className="mt-4 space-y-3">
                {imageAssets.length > 0 && (
                  <div className="flex flex-wrap gap-3">
                    {imageAssets.map((asset: any, i: number) => (
                      <div key={i} className="relative group">
                        <img
                          src={asset.base64}
                          alt={asset.name || `Concept image ${i + 1}`}
                          className="rounded-lg border border-border/50 max-h-48 object-contain"
                        />
                        <p className="text-[10px] text-muted-foreground mt-1 truncate max-w-[200px]">{asset.name}</p>
                      </div>
                    ))}
                  </div>
                )}
                {pdfAssets.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {pdfAssets.map((asset: any, i: number) => (
                      <Badge key={i} variant="secondary" className="gap-1">
                        <FileText className="h-3 w-3" />
                        {asset.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
          {(() => {
            const opts = typeof test.options === 'string' ? JSON.parse(test.options) : (test.options || {});
            const ctx = opts.strategic_context;
            if (!ctx || (!ctx.creative_ambition && !ctx.strategic_truth && !ctx.key_insight)) return null;
            return (
              <div className="mt-4 pt-3 border-t border-border/50 space-y-1">
                <p className="text-xs font-medium text-muted-foreground mb-2">Strategic Context</p>
                {ctx.creative_ambition && (
                  <p className="text-xs"><span className="text-muted-foreground">Creative Ambition:</span> {ctx.creative_ambition}</p>
                )}
                {ctx.strategic_truth && (
                  <p className="text-xs"><span className="text-muted-foreground">Strategic Truth:</span> {ctx.strategic_truth}</p>
                )}
                {ctx.key_insight && (
                  <p className="text-xs"><span className="text-muted-foreground">Key Insight:</span> {ctx.key_insight}</p>
                )}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Failed State */}
      {test.status === 'failed' && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="py-6">
            <div className="flex items-start gap-4">
              <AlertTriangle className="h-6 w-6 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-destructive mb-1">Test Failed</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Something went wrong while processing this test. This is typically caused by an API rate limit or temporary service issue.
                </p>
                <div className="text-xs text-muted-foreground mb-4 space-y-1">
                  <p>
                    <span className="font-medium">Responses completed:</span>{' '}
                    {test.responses_completed || 0} / {test.responses_total || '?'}
                  </p>
                  <p>
                    <span className="font-medium">Personas:</span>{' '}
                    {test.persona_ids?.length || 0} selected
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="border-destructive/50 text-destructive hover:bg-destructive/10"
                    onClick={async () => {
                      try {
                        await testsApi.run(test.id);
                        loadTest();
                      } catch (err: any) {
                        console.error('Failed to retry test:', err);
                      }
                    }}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Quick Retry
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => navigate(`/tests/new?retry=${test.id}`)}
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit & Retry
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Running State with Live Dashboard */}
      {test.status === 'running' && (() => {
        const liveStats = calculateLiveStats(responses);
        const sentimentData = liveStats ? [
          { name: 'Positive', value: liveStats.summary.sentiment.positive, color: COLORS.positive },
          { name: 'Neutral', value: liveStats.summary.sentiment.neutral, color: COLORS.neutral },
          { name: 'Negative', value: liveStats.summary.sentiment.negative, color: COLORS.negative },
        ].filter(d => d.value > 0) : [];

        return (
          <div className="space-y-6">
            {/* Progress Card */}
            <Card className="border-primary/50 bg-primary/5">
              <CardContent className="py-6">
                <div className="flex items-center gap-6">
                  <RefreshCw className="h-10 w-10 text-primary animate-spin flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">Generating Responses...</h3>
                      <span className="text-sm font-medium text-primary">
                        {test.responses_completed} / {test.responses_total}
                      </span>
                    </div>
                    <Progress value={progressPercent} className="h-2" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Live Stats - only show if we have responses */}
            {liveStats && (
              <>
                {/* Live RalphScore™ */}
                {(() => {
                  const liveRalphScore = calculateRalphScore(liveStats.summary);
                  const { label, color } = getRalphScoreLabel(liveRalphScore);
                  return (
                    <Card className="bg-gradient-to-br from-[#D94D8F]/10 via-transparent to-transparent border-[#D94D8F]/30">
                      <CardContent className="py-4">
                        <div className="flex items-center justify-between">
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground">Live RalphScore™</p>
                            <div className="flex items-baseline gap-2">
                              <span className="text-3xl font-bold text-[#D94D8F]">{liveRalphScore}</span>
                              <span className="text-sm text-muted-foreground">/100</span>
                              <span className={`text-xs font-semibold ${color}`}>{label}</span>
                            </div>
                          </div>
                          <div className="flex gap-1">
                            {[...Array(5)].map((_, i) => (
                              <div
                                key={i}
                                className={`w-2 h-2 rounded-full transition-all ${
                                  i < Math.ceil(liveRalphScore / 20)
                                    ? 'bg-[#D94D8F]'
                                    : 'bg-muted'
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}

                {/* Summary Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        Responses So Far
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{liveStats.summary.total_responses}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" />
                        Avg Engagement
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{liveStats.summary.avg_engagement}/10</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <MessageSquare className="h-4 w-4" />
                        Share Likelihood
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{liveStats.summary.avg_share_likelihood}/10</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Sparkles className="h-4 w-4" />
                        Comprehension
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{liveStats.summary.avg_comprehension}/10</div>
                    </CardContent>
                  </Card>
                </div>

                {/* Sentiment Chart */}
                {sentimentData.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card>
                      <CardHeader>
                        <CardTitle>Live Sentiment Distribution</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={200}>
                          <PieChart>
                            <Pie
                              data={sentimentData}
                              cx="50%"
                              cy="50%"
                              innerRadius={40}
                              outerRadius={80}
                              paddingAngle={5}
                              dataKey="value"
                            >
                              {sentimentData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip />
                            <Legend />
                          </PieChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>

                    {/* Recent Responses Preview */}
                    <Card>
                      <CardHeader>
                        <CardTitle>Latest Responses</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3 max-h-[250px] overflow-y-auto">
                        {responses.slice(0, 5).map((r, i) => (
                          <div key={i} className="p-3 bg-muted/50 rounded-lg">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-sm">{r.variant_name}</span>
                              <Badge variant="outline" className="text-xs">
                                {r.primary_platform}
                              </Badge>
                              <span className={`text-xs font-medium ${
                                (r.sentiment_score ?? 5) >= SENTIMENT_THRESHOLDS.POSITIVE_MIN ? 'text-green-600' :
                                (r.sentiment_score ?? 5) >= SENTIMENT_THRESHOLDS.NEUTRAL_MIN ? 'text-yellow-600' : 'text-red-600'
                              }`}>
                                {r.sentiment_score ?? 5}/10
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {r.response_text}
                            </p>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* Results */}
      {test.status === 'complete' && results && (
        <Tabs defaultValue="dashboard">
          <TabsList>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="responses">Responses ({responses.length})</TabsTrigger>
            <TabsTrigger value="themes">Themes</TabsTrigger>
            <TabsTrigger value="insights-chat" className="flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />
              Chat
            </TabsTrigger>
            {results.gwi_enrichment && (
              <TabsTrigger value="market-insights" className="flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-emerald-600" />
                Market Insights
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="dashboard" className="space-y-6">
            {/* RalphScore™ */}
            {(() => {
              const ralphScore = calculateRalphScore(results.summary);
              const { label, color } = getRalphScoreLabel(ralphScore);
              return (
                <Card className="bg-gradient-to-br from-[#D94D8F]/10 via-transparent to-transparent border-[#D94D8F]/30">
                  <CardContent className="py-6">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-muted-foreground">RalphScore™</p>
                        <div className="flex items-baseline gap-3">
                          <span className="text-5xl font-bold text-[#D94D8F]">{ralphScore}</span>
                          <span className="text-lg text-muted-foreground">/100</span>
                        </div>
                        <p className={`text-sm font-semibold ${color}`}>{label}</p>
                      </div>
                      <div className="text-right space-y-2">
                        <p className="text-xs text-muted-foreground max-w-[200px]">
                          Proprietary benchmark combining sentiment, engagement, shareability, and comprehension.
                        </p>
                        <div className="flex gap-1 justify-end">
                          {[...Array(5)].map((_, i) => (
                            <div
                              key={i}
                              className={`w-3 h-3 rounded-full ${
                                i < Math.ceil(ralphScore / 20)
                                  ? 'bg-[#D94D8F]'
                                  : 'bg-muted'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })()}

            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Total Responses
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{results.summary.total_responses}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Avg Engagement
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{results.summary.avg_engagement}/10</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Share Likelihood
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{results.summary.avg_share_likelihood}/10</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    Comprehension
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{results.summary.avg_comprehension}/10</div>
                </CardContent>
              </Card>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Sentiment Pie Chart */}
              <Card>
                <CardHeader>
                  <CardTitle>Sentiment Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Positive', value: results.summary.sentiment.positive },
                          { name: 'Neutral', value: results.summary.sentiment.neutral },
                          { name: 'Negative', value: results.summary.sentiment.negative },
                        ]}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        <Cell fill={COLORS.positive} />
                        <Cell fill={COLORS.neutral} />
                        <Cell fill={COLORS.negative} />
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Platform Breakdown */}
              <Card>
                <CardHeader>
                  <CardTitle>By Platform</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart
                      data={Object.entries(results.segments.by_platform).map(([name, data]) => ({
                        name,
                        sentiment: data.avgSentiment,
                        engagement: data.avgEngagement,
                        count: data.count,
                      }))}
                    >
                      <XAxis dataKey="name" />
                      <YAxis domain={[0, 10]} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="sentiment" name="Avg Sentiment" fill="#8b5cf6" />
                      <Bar dataKey="engagement" name="Avg Engagement" fill="#06b6d4" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Attitude Segments */}
            <Card>
              <CardHeader>
                <CardTitle>By Attitude</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {Object.entries(results.segments.by_attitude).map(([group, data]) => (
                    <div key={group} className="p-4 rounded-lg bg-muted/50">
                      <h4 className="font-medium capitalize">{group}</h4>
                      <p className="text-sm text-muted-foreground">{data.count} responses</p>
                      <div className="mt-2 space-y-1">
                        <div className="flex justify-between text-sm">
                          <span>Avg Sentiment</span>
                          <span className="font-medium">{data.avgSentiment}/10</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span>Avg Engagement</span>
                          <span className="font-medium">{data.avgEngagement}/10</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Brain Balance */}
            <BrainBalance responses={responses} />

            {/* Emotional Spectrum */}
            <EmotionalSpectrum responses={responses} />

            {/* Key Associations + Shareability side by side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <KeyAssociations themes={results.themes} />
              <ShareabilityAnalysis responses={responses} summary={results.summary} segments={results.segments} />
            </div>

            {/* Recommendations */}
            <GwiRecommendations testId={test.id} />

            {/* Test Comparison */}
            <TestComparison
              currentTest={test}
              currentSummary={results.summary}
              currentRalphScore={calculateRalphScore(results.summary)}
            />
          </TabsContent>

          <TabsContent value="responses" className="space-y-4">
            {/* Filters */}
            <div className="flex items-center gap-4">
              <Select value={sentimentFilter} onValueChange={setSentimentFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Sentiment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sentiment</SelectItem>
                  <SelectItem value="positive">Positive</SelectItem>
                  <SelectItem value="neutral">Neutral</SelectItem>
                  <SelectItem value="negative">Negative</SelectItem>
                </SelectContent>
              </Select>
              <Select value={platformFilter} onValueChange={setPlatformFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Platform" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Platforms</SelectItem>
                  {platforms.map((p) => (
                    <SelectItem key={p} value={p!}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">
                Showing {filteredResponses.length} of {responses.length}
              </span>
            </div>

            {/* Response Cards */}
            <div className="space-y-4">
              {filteredResponses.map((response) => (
                <Card key={response.id}>
                  <CardContent className="py-4">
                    <div className="flex items-start gap-4">
                      <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="text-lg font-semibold text-primary">
                          {response.variant_name?.charAt(0) || '?'}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-medium">{response.variant_name}</span>
                          <span className="text-sm text-muted-foreground">
                            {response.age_actual} yo
                          </span>
                          <Badge variant="outline">{response.primary_platform}</Badge>
                          <Badge
                            variant={
                              (response.sentiment_score || 5) >= SENTIMENT_THRESHOLDS.POSITIVE_MIN
                                ? 'success'
                                : (response.sentiment_score || 5) < SENTIMENT_THRESHOLDS.NEUTRAL_MIN
                                ? 'destructive'
                                : 'secondary'
                            }
                          >
                            {response.sentiment_score}/10
                          </Badge>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{response.response_text}</p>
                        <div className="flex flex-wrap gap-1 mt-3">
                          {response.reaction_tags?.map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                        <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
                          <span>Engagement: {response.engagement_likelihood}/10</span>
                          <span>Share: {response.share_likelihood}/10</span>
                          <span>Comprehension: {response.comprehension_score}/10</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="themes" className="space-y-6">
            {/* Positive Themes */}
            <Card>
              <CardHeader>
                <CardTitle className="text-green-600 flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  What's Working
                </CardTitle>
              </CardHeader>
              <CardContent>
                {results.themes.positive_themes.length > 0 ? (
                  <div className="space-y-2">
                    {results.themes.positive_themes.map((theme, i) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950 rounded-lg">
                        <span className="text-green-900 dark:text-green-100">{theme.theme}</span>
                        <Badge variant="secondary">{theme.frequency} mentions</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No positive themes identified</p>
                )}
              </CardContent>
            </Card>

            {/* Concerns */}
            <Card>
              <CardHeader>
                <CardTitle className="text-red-600 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Concerns
                </CardTitle>
              </CardHeader>
              <CardContent>
                {results.themes.concerns.length > 0 ? (
                  <div className="space-y-2">
                    {results.themes.concerns.map((theme, i) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-950 rounded-lg">
                        <span className="text-red-900 dark:text-red-100">{theme.theme}</span>
                        <Badge variant="secondary">{theme.frequency} mentions</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No concerns identified</p>
                )}
              </CardContent>
            </Card>

            {/* Unexpected */}
            <Card>
              <CardHeader>
                <CardTitle className="text-purple-600 flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  Unexpected Findings
                </CardTitle>
              </CardHeader>
              <CardContent>
                {results.themes.unexpected.length > 0 ? (
                  <div className="space-y-2">
                    {results.themes.unexpected.map((theme, i) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-purple-50 dark:bg-purple-950 rounded-lg">
                        <span className="text-purple-900 dark:text-purple-100">{theme.theme}</span>
                        <Badge variant="secondary">{theme.frequency} mentions</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No unexpected findings</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Insights Chat Tab */}
          <TabsContent value="insights-chat">
            <Card>
              <InsightsChat testId={test.id} />
            </Card>
          </TabsContent>

          {/* Market Insights Tab (GWI) */}
          {results.gwi_enrichment && (
            <TabsContent value="market-insights" className="space-y-6">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <GwiBadge />
                  <span className="text-sm text-muted-foreground">Powered by GWI Spark market data</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        const result = await gwiApi.enrichResults(test.id);
                        if (result.enrichment) {
                          loadTest(); // Reload to show updated data
                        }
                      } catch (err) {
                        console.error('Failed to refresh GWI analysis:', err);
                      }
                    }}
                    className="gap-2"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Re-run Analysis
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testsApi.exportReport(test.id)}
                    className="gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Export Full Report (JSON)
                  </Button>
                </div>
              </div>

              {/* Executive Summary */}
              {results.gwi_enrichment.executive_summary && (
                <Card className="border-emerald-200 bg-emerald-50/30">
                  <CardContent className="pt-6">
                    <p className="text-lg font-medium leading-relaxed">
                      {results.gwi_enrichment.executive_summary}
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Market Context */}
              {results.gwi_enrichment.market_context?.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-emerald-600" />
                      Market Alignment
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {results.gwi_enrichment.market_context.map((item: any, i: number) => (
                        <div key={i} className="p-4 rounded-lg border bg-emerald-50/20">
                          <div className="flex items-start gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="font-medium">{item.metric}</p>
                                {item.value && (
                                  <Badge variant="outline" className="text-emerald-600 border-emerald-600">
                                    {item.value}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground leading-relaxed">{item.insight}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Benchmark Comparison */}
              {results.gwi_enrichment.benchmark_comparison?.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Ralph vs Market Benchmarks</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-5">
                      {results.gwi_enrichment.benchmark_comparison.map((item: any, i: number) => (
                        <div key={i}>
                          <div className="flex items-center gap-4 mb-2">
                            <span className="text-sm font-medium w-40 flex-shrink-0">{item.metric}</span>
                            <div className="flex-1">
                              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                                <span>Ralph: {item.ralph_value}/10</span>
                                {item.gwi_benchmark > 0 && <span>GWI Benchmark: {item.gwi_benchmark}/10</span>}
                              </div>
                              <div className="relative h-2.5 bg-muted rounded-full">
                                <div
                                  className="absolute h-2.5 bg-[#D94D8F] rounded-full"
                                  style={{ width: `${Math.min(100, (item.ralph_value / 10) * 100)}%` }}
                                />
                                {item.gwi_benchmark > 0 && (
                                  <div
                                    className="absolute h-2.5 w-1 bg-emerald-600 rounded"
                                    style={{ left: `${Math.min(100, (item.gwi_benchmark / 10) * 100)}%` }}
                                  />
                                )}
                              </div>
                            </div>
                          </div>
                          {item.interpretation && (
                            <p className="text-xs text-muted-foreground ml-44 leading-relaxed">{item.interpretation}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Opportunities & Risks */}
              {(results.gwi_enrichment.opportunities?.length > 0 || results.gwi_enrichment.risks?.length > 0) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {results.gwi_enrichment.opportunities?.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Lightbulb className="h-5 w-5 text-emerald-600" />
                          Opportunities
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-3">
                          {results.gwi_enrichment.opportunities.map((opp: string, i: number) => (
                            <li key={i} className="flex gap-2 text-sm">
                              <span className="text-emerald-600 font-bold mt-0.5">•</span>
                              <span className="leading-relaxed">{opp}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}
                  {results.gwi_enrichment.risks?.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <ShieldAlert className="h-5 w-5 text-amber-500" />
                          Risks & Watchouts
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-3">
                          {results.gwi_enrichment.risks.map((risk: string, i: number) => (
                            <li key={i} className="flex gap-2 text-sm">
                              <span className="text-amber-500 font-bold mt-0.5">•</span>
                              <span className="leading-relaxed">{risk}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {/* Full Analysis Narrative */}
              {results.gwi_enrichment.analysis_narrative && (() => {
                // Filter out GWI boilerplate/template content
                const narrative = results.gwi_enrichment.analysis_narrative as string;
                const cleanedLines = narrative.split('\n').filter((line: string) => {
                  const trimmed = line.trim();
                  if (!trimmed) return true; // keep blank lines
                  // Skip boilerplate
                  if (trimmed.includes('Processing Instructions')) return false;
                  if (trimmed.includes('explore_insight_gwi')) return false;
                  if (trimmed.includes('Data Analysis Result')) return false;
                  if (trimmed.includes('structured information for you to process')) return false;
                  if (trimmed.includes('The main response provides')) return false;
                  if (trimmed.includes('Each insight has a unique ID')) return false;
                  if (trimmed.includes('Source information shows')) return false;
                  if (trimmed.includes('contains a "Chat ID"')) return false;
                  if (trimmed.includes('Reference specific insights by their IDs')) return false;
                  if (trimmed.includes('Consider the source information')) return false;
                  if (trimmed.includes('Note the time periods')) return false;
                  if (trimmed.includes('include both the name and code')) return false;
                  if (/^Chat ID:\s*[a-f0-9-]+$/i.test(trimmed)) return false;
                  if (trimmed === '## Main Response') return false;
                  if (trimmed === '## Sources') return false;
                  if (trimmed === '## Processing Instructions') return false;
                  if (trimmed === 'The following metadata describes the origin of the insights:') return false;
                  if (trimmed === 'When responding to users about this data:') return false;
                  return true;
                });

                // Check if there's any meaningful content left
                const hasContent = cleanedLines.some((l: string) => l.trim().length > 10);
                if (!hasContent) return null;

                return (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Globe className="h-5 w-5 text-emerald-600" />
                        Full GWI Analysis
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="prose prose-sm max-w-none text-muted-foreground">
                        {cleanedLines.map((line: string, i: number) => {
                          if (!line.trim()) return <br key={i} />;
                          // Markdown headers
                          if (/^#{1,3}\s/.test(line.trim())) {
                            return <p key={i} className="font-semibold text-foreground mt-4 mb-1">{line.replace(/^#+\s*/, '')}</p>;
                          }
                          // Bold headers (lines that are all caps or start with numbers)
                          if (/^\d+\.\s+[A-Z]/.test(line.trim()) || /^[A-Z\s&]{5,}:?$/.test(line.trim())) {
                            return <p key={i} className="font-semibold text-foreground mt-4 mb-1">{line}</p>;
                          }
                          // Bold text markers (**text**)
                          if (/\*\*/.test(line)) {
                            return <p key={i} className="mb-1" dangerouslySetInnerHTML={{
                              __html: line.replace(/\*\*(.+?)\*\*/g, '<strong class="text-foreground">$1</strong>')
                            }} />;
                          }
                          // Bullet points
                          if (/^\s*[-•*]/.test(line)) {
                            return <p key={i} className="ml-4">{line.replace(/^\s*[-•*]\s*/, '• ')}</p>;
                          }
                          return <p key={i} className="mb-1">{line}</p>;
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}

              {/* Audience Recommendations */}
              {results.gwi_enrichment.audience_recommendations?.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Users className="h-5 w-5 text-emerald-600" />
                      GWI Suggests Also Testing With
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {results.gwi_enrichment.audience_recommendations.map((audience: any, i: number) => (
                        <div key={i} className="p-4 rounded-lg border">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="font-medium">{audience.name}</h4>
                            {audience.size_percent > 0 && (
                              <Badge variant="outline" className="text-emerald-600 border-emerald-600">
                                {audience.size_percent}% of market
                              </Badge>
                            )}
                          </div>
                          {audience.demographics?.age_range && (
                            <p className="text-sm text-muted-foreground">
                              Age: {audience.demographics.age_range}
                            </p>
                          )}
                          {audience.media_habits?.top_platforms?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {audience.media_habits.top_platforms.map((p: string) => (
                                <Badge key={p} variant="secondary" className="text-xs">{p}</Badge>
                              ))}
                            </div>
                          )}
                          {audience.psychographics?.values?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {audience.psychographics.values.map((v: string) => (
                                <Badge key={v} variant="outline" className="text-xs">{v}</Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
