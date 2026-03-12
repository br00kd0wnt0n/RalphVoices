import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';
import type { TestResultsThemes } from '@/types';

interface KeyAssociationsProps {
  themes: TestResultsThemes;
}

function getTypeColor(type: 'positive' | 'concern' | 'unexpected'): string {
  if (type === 'positive') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (type === 'concern') return 'bg-red-100 text-red-800 border-red-200';
  return 'bg-purple-100 text-purple-800 border-purple-200';
}

function getTypeLabel(type: 'positive' | 'concern' | 'unexpected'): string {
  if (type === 'positive') return 'Strength';
  if (type === 'concern') return 'Concern';
  return 'Surprise';
}

export function KeyAssociations({ themes }: KeyAssociationsProps) {
  // Merge all themes, tag with type, sort by frequency
  const allThemes = [
    ...themes.positive_themes.map((t) => ({ ...t, type: 'positive' as const })),
    ...themes.concerns.map((t) => ({ ...t, type: 'concern' as const })),
    ...themes.unexpected.map((t) => ({ ...t, type: 'unexpected' as const })),
  ]
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 5);

  if (allThemes.length === 0) return null;

  const maxFreq = allThemes[0]?.frequency || 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.25 }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" />
            Top 5 Key Associations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {allThemes.map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.3 + i * 0.05 }}
              className="flex items-center gap-3"
            >
              <span className="text-lg font-bold text-muted-foreground/50 w-6 text-right">
                {i + 1}
              </span>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">{item.theme}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${getTypeColor(item.type)}`}>
                    {getTypeLabel(item.type)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(item.frequency / maxFreq) * 100}%` }}
                    transition={{ duration: 0.6, delay: 0.4 + i * 0.05 }}
                    className={`h-full rounded-full ${
                      item.type === 'positive' ? 'bg-emerald-500' :
                      item.type === 'concern' ? 'bg-red-400' : 'bg-purple-400'
                    }`}
                  />
                </div>
              </div>
              <span className="text-sm text-muted-foreground font-medium">{item.frequency}×</span>
            </motion.div>
          ))}
        </CardContent>
      </Card>
    </motion.div>
  );
}
