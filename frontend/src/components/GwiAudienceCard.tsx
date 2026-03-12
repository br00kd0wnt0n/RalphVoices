import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { GwiBadge } from './GwiBadge';
import { Users, UserPlus } from 'lucide-react';
import type { GwiAudience } from '@/types/gwi';

interface GwiAudienceCardProps {
  audience: GwiAudience;
  selected: boolean;
  onToggle: () => void;
  onCreatePersona?: () => void;
}

export function GwiAudienceCard({ audience, selected, onToggle, onCreatePersona }: GwiAudienceCardProps) {
  return (
    <Card
      className={`cursor-pointer transition-all ${
        selected
          ? 'border-emerald-500 bg-emerald-500/5 shadow-sm'
          : 'hover:border-emerald-500/50'
      }`}
      onClick={onToggle}
    >
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start gap-3">
          <Checkbox checked={selected} className="mt-1" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-medium text-sm truncate">{audience.name}</h4>
              <GwiBadge />
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {audience.size_percent}% of population
              </span>
              <span>Index: {audience.index_score}</span>
              <span>{audience.demographics.age_range}</span>
            </div>

            {audience.media_habits.top_platforms.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {audience.media_habits.top_platforms.slice(0, 4).map((platform) => (
                  <Badge key={platform} variant="secondary" className="text-[10px] px-1.5 py-0">
                    {platform}
                  </Badge>
                ))}
              </div>
            )}

            {audience.psychographics.values.length > 0 && (
              <p className="text-xs text-muted-foreground truncate">
                Values: {audience.psychographics.values.slice(0, 3).join(', ')}
              </p>
            )}

            {onCreatePersona && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 h-7 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 p-0 px-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onCreatePersona();
                }}
              >
                <UserPlus className="h-3 w-3 mr-1" />
                Create Persona from This
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
