import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';
import { Share2 } from 'lucide-react';
import type { TestResponse, TestResultsSummary, TestResultsSegments } from '@/types';

interface ShareabilityAnalysisProps {
  responses: TestResponse[];
  summary: TestResultsSummary;
  segments: TestResultsSegments;
}

export function ShareabilityAnalysis({ responses, summary }: ShareabilityAnalysisProps) {
  const avgShare = summary.avg_share_likelihood;

  // Calculate share likelihood by platform
  const platformShares: Record<string, { total: number; count: number }> = {};
  for (const r of responses) {
    const platform = r.primary_platform || 'Other';
    if (!platformShares[platform]) platformShares[platform] = { total: 0, count: 0 };
    platformShares[platform].total += r.share_likelihood || 0;
    platformShares[platform].count++;
  }

  const platformData = Object.entries(platformShares)
    .map(([name, d]) => ({
      name,
      share: Math.round((d.total / d.count) * 10) / 10,
    }))
    .sort((a, b) => b.share - a.share);

  // Calculate share likelihood by attitude
  const attitudeShares: Record<string, { total: number; count: number }> = {};
  for (const r of responses) {
    const attitude = (r.attitude_score || 5) >= 7 ? 'Enthusiasts' :
      (r.attitude_score || 5) <= 3 ? 'Skeptics' : 'Neutral';
    if (!attitudeShares[attitude]) attitudeShares[attitude] = { total: 0, count: 0 };
    attitudeShares[attitude].total += r.share_likelihood || 0;
    attitudeShares[attitude].count++;
  }

  const attitudeData = Object.entries(attitudeShares)
    .map(([name, d]) => ({
      name,
      share: Math.round((d.total / d.count) * 10) / 10,
    }));

  // Viral potential
  const positiveRatio = summary.sentiment.positive / summary.total_responses;
  const isViral = avgShare >= 7 && positiveRatio >= 0.6;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
    >
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Share2 className="h-5 w-5 text-cyan-500" />
                Shareability Analysis
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">Who would share and where</p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-cyan-600">{avgShare}</div>
              <div className="text-xs text-muted-foreground">/10 avg share</div>
              {isViral && (
                <Badge className="mt-1 bg-gradient-to-r from-pink-500 to-purple-500 text-white border-0">
                  Viral Potential
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* By Platform */}
            <div>
              <h4 className="text-sm font-medium mb-3">By Platform</h4>
              <ResponsiveContainer width="100%" height={platformData.length * 36 + 20}>
                <BarChart data={platformData} layout="vertical" margin={{ left: 70, right: 20 }}>
                  <XAxis type="number" domain={[0, 10]} />
                  <YAxis type="category" dataKey="name" width={65} tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: number) => [`${value}/10`, 'Share Likelihood']}
                    contentStyle={{ borderRadius: '8px', fontSize: '13px' }}
                  />
                  <Bar dataKey="share" fill="#06b6d4" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* By Attitude */}
            <div>
              <h4 className="text-sm font-medium mb-3">By Attitude</h4>
              <ResponsiveContainer width="100%" height={attitudeData.length * 36 + 20}>
                <BarChart data={attitudeData} layout="vertical" margin={{ left: 80, right: 20 }}>
                  <XAxis type="number" domain={[0, 10]} />
                  <YAxis type="category" dataKey="name" width={75} tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: number) => [`${value}/10`, 'Share Likelihood']}
                    contentStyle={{ borderRadius: '8px', fontSize: '13px' }}
                  />
                  <Bar dataKey="share" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
