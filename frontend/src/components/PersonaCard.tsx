import { useState } from 'react';
import { personas as personasApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, RefreshCw, Users, MapPin, Briefcase, ChevronDown, ChevronUp } from 'lucide-react';
import type { Persona } from '@/types';

interface PersonaCardProps {
  persona: Persona;
  onDelete: () => void;
  onUpdate: () => void;
}

export function PersonaCard({ persona, onDelete, onUpdate }: PersonaCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [generating, setGenerating] = useState(false);

  async function handleGenerateVariants() {
    setGenerating(true);
    try {
      await personasApi.generateVariants(persona.id, {
        count: 20,
        age_spread: 5,
        attitude_distribution: 'normal',
        platforms_to_include: ['TikTok', 'Instagram', 'YouTube', 'Twitter/X'],
      });
      onUpdate();
    } catch (error) {
      console.error('Failed to generate variants:', error);
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this persona?')) return;
    try {
      await personasApi.delete(persona.id);
      onDelete();
    } catch (error) {
      console.error('Failed to delete persona:', error);
    }
  }

  const platforms = persona.media_habits?.primary_platforms?.map((p) => p.name) || [];

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{persona.name}</CardTitle>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
              {persona.age_base && <span>{persona.age_base} years old</span>}
              {persona.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {persona.location}
                </span>
              )}
              {persona.occupation && (
                <span className="flex items-center gap-1">
                  <Briefcase className="h-3 w-3" />
                  {persona.occupation}
                </span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            onClick={handleDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Values & Platforms */}
        <div className="flex flex-wrap gap-1">
          {persona.psychographics?.values?.slice(0, 3).map((value) => (
            <Badge key={value} variant="secondary" className="text-xs">
              {value}
            </Badge>
          ))}
          {platforms.slice(0, 2).map((platform) => (
            <Badge key={platform} variant="outline" className="text-xs">
              {platform}
            </Badge>
          ))}
        </div>

        {/* Voice Sample Preview */}
        {persona.voice_sample && (
          <div className="text-sm text-muted-foreground italic line-clamp-2">
            "{persona.voice_sample.slice(0, 150)}..."
          </div>
        )}

        {/* Expanded Content */}
        {expanded && (
          <div className="space-y-3 pt-2 border-t">
            {persona.psychographics?.motivations && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Motivations</p>
                <p className="text-sm">{persona.psychographics.motivations.join(', ')}</p>
              </div>
            )}
            {persona.psychographics?.pain_points && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Pain Points</p>
                <p className="text-sm">{persona.psychographics.pain_points.join(', ')}</p>
              </div>
            )}
            {persona.cultural_context?.humor_style && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Humor Style</p>
                <p className="text-sm">{persona.cultural_context.humor_style}</p>
              </div>
            )}
            {persona.voice_sample && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Voice Sample</p>
                <p className="text-sm italic">"{persona.voice_sample}"</p>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-4 w-4" /> Show less
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4" /> Show more
              </>
            )}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <Users className="h-4 w-4" />
              {persona.variant_count || 0} variants
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerateVariants}
              disabled={generating}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${generating ? 'animate-spin' : ''}`} />
              {generating ? 'Generating...' : 'Generate Variants'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
