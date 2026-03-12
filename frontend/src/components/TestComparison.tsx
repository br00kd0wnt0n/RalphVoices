import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend } from 'recharts';
import { motion } from 'framer-motion';
import { GitCompareArrows } from 'lucide-react';
import { tests as testsApi } from '@/lib/api';
import type { Test, TestResultsSummary } from '@/types';

interface TestComparisonProps {
  currentTest: Test;
  currentSummary: TestResultsSummary;
  currentRalphScore: number;
}

export function TestComparison({ currentTest, currentSummary, currentRalphScore }: TestComparisonProps) {
  const [otherTests, setOtherTests] = useState<Test[]>([]);
  const [selectedTestId, setSelectedTestId] = useState<string>('');
  const [compareTest, setCompareTest] = useState<Test | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadTests() {
      try {
        const allTests = await testsApi.list();
        const completed = allTests.filter(
          (t: Test) => t.status === 'complete' && t.id !== currentTest.id && t.project_id === currentTest.project_id
        );
        setOtherTests(completed);
      } catch (e) {
        console.error('Failed to load tests for comparison:', e);
      }
    }
    loadTests();
  }, [currentTest.id, currentTest.project_id]);

  useEffect(() => {
    if (!selectedTestId) {
      setCompareTest(null);
      return;
    }
    async function loadCompare() {
      setLoading(true);
      try {
        const data = await testsApi.get(selectedTestId);
        setCompareTest(data);
      } catch (e) {
        console.error('Failed to load comparison test:', e);
      } finally {
        setLoading(false);
      }
    }
    loadCompare();
  }, [selectedTestId]);

  // Build radar data
  const currentTotal = currentSummary.sentiment.positive + currentSummary.sentiment.neutral + currentSummary.sentiment.negative;
  const currentSentimentScore = currentTotal > 0
    ? Math.round(((currentSummary.sentiment.positive * 10 + currentSummary.sentiment.neutral * 5 + currentSummary.sentiment.negative * 1) / currentTotal) * 10) / 10
    : 5;

  const radarData = [
    { metric: 'Sentiment', current: currentSentimentScore, compare: 0 },
    { metric: 'Engagement', current: currentSummary.avg_engagement, compare: 0 },
    { metric: 'Shareability', current: currentSummary.avg_share_likelihood, compare: 0 },
    { metric: 'Comprehension', current: currentSummary.avg_comprehension, compare: 0 },
  ];

  let compareSummary: TestResultsSummary | null = null;
  let compareRalphScore = 0;

  if (compareTest?.results?.summary) {
    compareSummary = compareTest.results.summary;
    const cTotal = compareSummary.sentiment.positive + compareSummary.sentiment.neutral + compareSummary.sentiment.negative;
    const cSentiment = cTotal > 0
      ? Math.round(((compareSummary.sentiment.positive * 10 + compareSummary.sentiment.neutral * 5 + compareSummary.sentiment.negative * 1) / cTotal) * 10) / 10
      : 5;

    radarData[0].compare = cSentiment;
    radarData[1].compare = compareSummary.avg_engagement;
    radarData[2].compare = compareSummary.avg_share_likelihood;
    radarData[3].compare = compareSummary.avg_comprehension;

    // Rough RalphScore calc
    const baseScore = (cSentiment * 0.30) + (compareSummary.avg_engagement * 0.30) +
      (compareSummary.avg_share_likelihood * 0.25) + (compareSummary.avg_comprehension * 0.15);
    const positiveRatio = cTotal > 0 ? compareSummary.sentiment.positive / cTotal : 0;
    const negativeRatio = cTotal > 0 ? compareSummary.sentiment.negative / cTotal : 0;
    const modifier = 1 + (positiveRatio * 0.1) - (negativeRatio * 0.15);
    compareRalphScore = Math.max(0, Math.min(100, Math.round(baseScore * 10 * modifier)));
  }

  if (otherTests.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.35 }}
    >
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <GitCompareArrows className="h-5 w-5 text-indigo-500" />
              Compare With Other Tests
            </CardTitle>
            <Select value={selectedTestId} onValueChange={setSelectedTestId}>
              <SelectTrigger className="w-[250px]">
                <SelectValue placeholder="Select a test to compare..." />
              </SelectTrigger>
              <SelectContent>
                {otherTests.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {!selectedTestId ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Select another completed test from this project to compare results side-by-side.
            </p>
          ) : loading ? (
            <div className="h-[300px] flex items-center justify-center">
              <div className="animate-pulse text-muted-foreground">Loading comparison...</div>
            </div>
          ) : compareSummary ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Radar Chart */}
              <div>
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={radarData}>
                    <PolarGrid strokeDasharray="3 3" />
                    <PolarAngleAxis dataKey="metric" tick={{ fontSize: 12 }} />
                    <PolarRadiusAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
                    <Radar name={currentTest.name} dataKey="current" stroke="#D94D8F" fill="#D94D8F" fillOpacity={0.2} />
                    <Radar name={compareTest?.name || 'Compare'} dataKey="compare" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} />
                    <Legend />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              {/* Score comparison */}
              <div className="space-y-4">
                {/* RalphScore comparison */}
                <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/50">
                  <div className="flex-1 text-center">
                    <div className="text-3xl font-bold text-[#D94D8F]">{currentRalphScore}</div>
                    <div className="text-xs text-muted-foreground mt-1">Current</div>
                  </div>
                  <div className="text-2xl font-light text-muted-foreground">vs</div>
                  <div className="flex-1 text-center">
                    <div className="text-3xl font-bold text-indigo-500">{compareRalphScore}</div>
                    <div className="text-xs text-muted-foreground mt-1">Compare</div>
                  </div>
                </div>

                {/* Metric-by-metric */}
                <div className="space-y-2">
                  {radarData.map((item) => {
                    const delta = item.current - item.compare;
                    return (
                      <div key={item.metric} className="flex items-center justify-between text-sm p-2 rounded-lg hover:bg-muted/30">
                        <span className="font-medium">{item.metric}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-[#D94D8F] font-semibold">{item.current}</span>
                          <span className="text-muted-foreground">vs</span>
                          <span className="text-indigo-500 font-semibold">{item.compare}</span>
                          <span className={`text-xs font-bold ${delta > 0 ? 'text-emerald-500' : delta < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                            {delta > 0 ? '↑' : delta < 0 ? '↓' : '='}{Math.abs(Math.round(delta * 10) / 10)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </motion.div>
  );
}
