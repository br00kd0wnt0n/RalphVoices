import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { Brain } from 'lucide-react';
import type { TestResponse } from '@/types';

const LEFT_BRAIN_TAGS = ['needs_more_info', 'seen_before', 'confused', 'skeptical'];
const RIGHT_BRAIN_TAGS = ['excited', 'inspired', 'amused', 'annoyed', 'bored', 'intrigued'];

interface BrainBalanceProps {
  responses: TestResponse[];
}

export function BrainBalance({ responses }: BrainBalanceProps) {
  let leftCount = 0;
  let rightCount = 0;

  for (const r of responses) {
    for (const tag of r.reaction_tags || []) {
      if (LEFT_BRAIN_TAGS.includes(tag)) leftCount++;
      if (RIGHT_BRAIN_TAGS.includes(tag)) rightCount++;
    }
    // Weight comprehension towards left brain, engagement towards right brain
    if ((r.comprehension_score || 5) >= 8) leftCount++;
    if ((r.engagement_likelihood || 5) >= 8) rightCount++;
  }

  const total = leftCount + rightCount;
  if (total === 0) return null;

  const leftPercent = Math.round((leftCount / total) * 100);
  const rightPercent = 100 - leftPercent;

  const insight = rightPercent > 65
    ? 'This concept triggers mostly emotional reactions — great for brand building.'
    : leftPercent > 65
    ? 'Audiences are thinking critically — consider adding more emotional hooks.'
    : 'A balanced mix of rational and emotional reactions — strong foundation.';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.15 }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-500" />
            Left Brain vs Right Brain
          </CardTitle>
          <p className="text-sm text-muted-foreground">Rational vs emotional response balance</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* The bar */}
          <div className="relative h-10 rounded-full overflow-hidden bg-muted flex">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${leftPercent}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="bg-blue-500 flex items-center justify-center text-white text-sm font-semibold"
              style={{ minWidth: leftPercent > 15 ? undefined : 0 }}
            >
              {leftPercent > 15 && `${leftPercent}%`}
            </motion.div>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${rightPercent}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="bg-[#D94D8F] flex items-center justify-center text-white text-sm font-semibold"
              style={{ minWidth: rightPercent > 15 ? undefined : 0 }}
            >
              {rightPercent > 15 && `${rightPercent}%`}
            </motion.div>
          </div>

          {/* Labels */}
          <div className="flex justify-between text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span className="text-muted-foreground">Rational ({leftCount})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Emotional ({rightCount})</span>
              <div className="w-3 h-3 rounded-full bg-[#D94D8F]" />
            </div>
          </div>

          {/* Insight */}
          <p className="text-sm text-muted-foreground italic">{insight}</p>
        </CardContent>
      </Card>
    </motion.div>
  );
}
