import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { motion } from 'framer-motion';
import type { TestResponse } from '@/types';

const POSITIVE_TAGS = ['excited', 'inspired', 'intrigued', 'amused', 'feels_authentic', 'fresh_take', 'would_share'];
const NEGATIVE_TAGS = ['confused', 'skeptical', 'bored', 'annoyed', 'feels_forced', 'seen_before', 'would_ignore'];

function getTagColor(tag: string): string {
  if (POSITIVE_TAGS.includes(tag)) return '#D94D8F';
  if (NEGATIVE_TAGS.includes(tag)) return '#ef4444';
  return '#6b7280';
}

function formatTag(tag: string): string {
  return tag.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface EmotionalSpectrumProps {
  responses: TestResponse[];
}

export function EmotionalSpectrum({ responses }: EmotionalSpectrumProps) {
  // Count reaction tags across all responses
  const tagCounts: Record<string, number> = {};
  for (const r of responses) {
    for (const tag of r.reaction_tags || []) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }

  const data = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({
      tag,
      label: formatTag(tag),
      count,
      color: getTagColor(tag),
    }));

  if (data.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Emotional Spectrum</CardTitle>
          <p className="text-sm text-muted-foreground">Reaction tags across all responses</p>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={Math.max(200, data.length * 36)}>
            <BarChart data={data} layout="vertical" margin={{ left: 100, right: 20 }}>
              <XAxis type="number" />
              <YAxis type="category" dataKey="label" width={95} tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(value: number) => [`${value} responses`, 'Count']}
                contentStyle={{ borderRadius: '8px', fontSize: '13px' }}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </motion.div>
  );
}
