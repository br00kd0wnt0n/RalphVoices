import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { tests as testsApi } from '@/lib/api';
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
import { ArrowLeft, RefreshCw, Users, TrendingUp, MessageSquare, AlertTriangle, Sparkles } from 'lucide-react';
import type { Test, TestResponse } from '@/types';

const COLORS = {
  positive: '#22c55e',
  neutral: '#eab308',
  negative: '#ef4444',
};

export function TestResultsPage() {
  const { id } = useParams<{ id: string }>();
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
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('[TestResults] WebSocket progress:', data);
        // Map WebSocket fields to test object fields
        setTest((prev) => prev ? {
          ...prev,
          status: data.status,
          responses_completed: data.completed,
          responses_total: data.total,
        } : null);
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
      if (sentimentFilter === 'positive' && score < 7) return false;
      if (sentimentFilter === 'neutral' && (score < 4 || score >= 7)) return false;
      if (sentimentFilter === 'negative' && score >= 4) return false;
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
        {test.status === 'running' && (
          <Button variant="outline" onClick={loadTest}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        )}
      </div>

      {/* Concept Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">Concept Tested</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap">{test.concept_text}</p>
        </CardContent>
      </Card>

      {/* Running State */}
      {test.status === 'running' && (
        <Card>
          <CardContent className="py-8">
            <div className="text-center space-y-4">
              <RefreshCw className="h-12 w-12 mx-auto text-primary animate-spin" />
              <div>
                <h3 className="text-lg font-semibold">Generating Responses...</h3>
                <p className="text-muted-foreground">
                  {test.responses_completed} of {test.responses_total} responses complete
                </p>
              </div>
              <Progress value={progressPercent} className="max-w-md mx-auto" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {test.status === 'complete' && results && (
        <Tabs defaultValue="dashboard">
          <TabsList>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="responses">Responses ({responses.length})</TabsTrigger>
            <TabsTrigger value="themes">Themes</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="space-y-6">
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
                              (response.sentiment_score || 5) >= 7
                                ? 'success'
                                : (response.sentiment_score || 5) < 4
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
        </Tabs>
      )}
    </div>
  );
}
