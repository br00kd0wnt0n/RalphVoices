import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import { Wand2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

interface Recommendation {
  title: string;
  description: string;
  target_segment: string;
  impact: 'high' | 'medium' | 'low';
  category: string;
}

interface GwiRecommendationsProps {
  testId: string;
}

const impactColors: Record<string, string> = {
  high: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  medium: 'bg-amber-100 text-amber-800 border-amber-200',
  low: 'bg-gray-100 text-gray-800 border-gray-200',
};

const categoryIcons: Record<string, string> = {
  messaging: '💬',
  visual: '🎨',
  platform: '📱',
  timing: '⏰',
  format: '📐',
};

export function GwiRecommendations({ testId }: GwiRecommendationsProps) {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  async function loadRecommendations() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/tests/${testId}/recommendations`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error('Failed to load recommendations');
      const data = await response.json();
      setRecommendations(data.recommendations || []);
      setLoaded(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (!loaded && !loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.4 }}
      >
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <Wand2 className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground mb-4">
              Get AI-powered suggestions for improving this concept
            </p>
            <Button onClick={loadRecommendations} variant="outline" className="gap-2">
              <Wand2 className="h-4 w-4" />
              Generate Recommendations
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-6 w-6 mx-auto mb-3 animate-spin text-[#D94D8F]" />
          <p className="text-sm text-muted-foreground">Analyzing results and generating recommendations...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-red-200">
        <CardContent className="py-6 text-center">
          <p className="text-sm text-red-600">{error}</p>
          <Button onClick={loadRecommendations} variant="outline" size="sm" className="mt-3">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (recommendations.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.4 }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-[#D94D8F]" />
            Executional Recommendations
          </CardTitle>
          <p className="text-sm text-muted-foreground">AI-powered suggestions to improve concept resonance</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recommendations.map((rec, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 + i * 0.05 }}
                className="p-4 rounded-lg border hover:border-[#D94D8F]/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span>{categoryIcons[rec.category] || '💡'}</span>
                    <h4 className="font-medium text-sm">{rec.title}</h4>
                  </div>
                  <Badge className={`text-xs border ${impactColors[rec.impact] || impactColors.medium}`}>
                    {rec.impact}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mb-2">{rec.description}</p>
                <p className="text-xs text-muted-foreground/70">Target: {rec.target_segment}</p>
              </motion.div>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
