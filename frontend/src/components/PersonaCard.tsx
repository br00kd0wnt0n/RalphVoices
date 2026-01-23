import { useState } from 'react';
import { personas as personasApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, RefreshCw, Users, MapPin, Briefcase, ChevronDown, ChevronUp, Loader2, Sparkles, Brain, CheckCircle } from 'lucide-react';
import type { Persona } from '@/types';

interface PersonaCardProps {
  persona: Persona;
  usedInProjects?: { id: string; name: string }[];
  onDelete: () => void;
  onUpdate: () => void;
}

type GenerationStep = 'idle' | 'connecting' | 'analyzing' | 'generating' | 'saving' | 'complete' | 'error';

const GENERATION_STEPS: { step: GenerationStep; label: string; duration: number }[] = [
  { step: 'connecting', label: 'Connecting to AI service...', duration: 1500 },
  { step: 'analyzing', label: 'Analyzing persona profile...', duration: 2000 },
  { step: 'generating', label: 'Generating unique variants...', duration: 0 }, // Runs until API returns
  { step: 'saving', label: 'Saving to database...', duration: 1000 },
  { step: 'complete', label: 'Generation complete!', duration: 1500 },
];

export function PersonaCard({ persona, usedInProjects, onDelete, onUpdate }: PersonaCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState<GenerationStep>('idle');
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [variantsGenerated, setVariantsGenerated] = useState<number | null>(null);

  async function handleGenerateVariants() {
    setGenerating(true);
    setGenerationError(null);
    setVariantsGenerated(null);

    // Step 1: Connecting
    setGenerationStep('connecting');
    await sleep(1500);

    // Step 2: Analyzing
    setGenerationStep('analyzing');
    await sleep(2000);

    // Step 3: Generating (actual API call)
    setGenerationStep('generating');

    try {
      const result = await personasApi.generateVariants(persona.id, {
        count: 20,
        age_spread: 5,
        attitude_distribution: 'normal',
        platforms_to_include: ['TikTok', 'Instagram', 'YouTube', 'Twitter/X'],
      }) as any; // Cast to any to access potential error fields

      // Check if API returned an error in the response body
      if (result.error || result.variants_generated === 0) {
        console.error('Variant generation failed:', result);
        setGenerationStep('error');
        const errorMsg = result.error || 'No variants generated';
        const debugInfo = result.debug ? `\n\nDebug: API Key Set: ${result.debug.api_key_set}, Model: ${result.debug.openai_model}` : '';
        setGenerationError(errorMsg + debugInfo);
        return;
      }

      // Step 4: Saving
      setGenerationStep('saving');
      setVariantsGenerated(result.variants_generated || 0);
      await sleep(1000);

      // Step 5: Complete
      setGenerationStep('complete');
      await sleep(1500);

      onUpdate();
    } catch (error) {
      console.error('Failed to generate variants:', error);
      setGenerationStep('error');
      setGenerationError(error instanceof Error ? error.message : 'Failed to generate variants');
    } finally {
      setTimeout(() => {
        setGenerating(false);
        setGenerationStep('idle');
      }, 500);
    }
  }

  function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

  const getStepIcon = (step: GenerationStep) => {
    switch (step) {
      case 'connecting':
        return <Loader2 className="h-6 w-6 text-[#D94D8F] animate-spin" />;
      case 'analyzing':
        return <Brain className="h-6 w-6 text-[#D94D8F] animate-pulse" />;
      case 'generating':
        return <Sparkles className="h-6 w-6 text-[#D94D8F] animate-pulse" />;
      case 'saving':
        return <Loader2 className="h-6 w-6 text-[#D94D8F] animate-spin" />;
      case 'complete':
        return <CheckCircle className="h-6 w-6 text-green-500" />;
      case 'error':
        return <Trash2 className="h-6 w-6 text-red-500" />;
      default:
        return null;
    }
  };

  const getStepLabel = (step: GenerationStep) => {
    const stepConfig = GENERATION_STEPS.find(s => s.step === step);
    if (step === 'complete' && variantsGenerated !== null) {
      return `Generated ${variantsGenerated} variants!`;
    }
    if (step === 'error') {
      return generationError || 'Generation failed';
    }
    return stepConfig?.label || '';
  };

  return (
    <Card className="overflow-hidden relative">
      {/* Generation Overlay */}
      {generating && generationStep !== 'idle' && (
        <div className="absolute inset-0 bg-background/95 backdrop-blur-sm z-10 flex items-center justify-center">
          <div className="text-center p-6 space-y-4">
            <div className="flex justify-center">
              {getStepIcon(generationStep)}
            </div>
            <div className="space-y-2">
              <p className="font-medium text-foreground">
                {getStepLabel(generationStep)}
              </p>
              {generationStep === 'generating' && (
                <p className="text-sm text-muted-foreground">
                  This may take up to 60 seconds...
                </p>
              )}
            </div>
            {/* Progress dots */}
            {generationStep !== 'complete' && generationStep !== 'error' && (
              <div className="flex justify-center gap-1 pt-2">
                {['connecting', 'analyzing', 'generating', 'saving'].map((s, i) => {
                  const currentIndex = ['connecting', 'analyzing', 'generating', 'saving'].indexOf(generationStep);
                  const isActive = i === currentIndex;
                  const isComplete = i < currentIndex;
                  return (
                    <div
                      key={s}
                      className={`w-2 h-2 rounded-full transition-all duration-300 ${
                        isComplete
                          ? 'bg-green-500'
                          : isActive
                          ? 'bg-[#D94D8F] animate-pulse'
                          : 'bg-muted-foreground/30'
                      }`}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-lg">{persona.name}</CardTitle>
              {usedInProjects && usedInProjects.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  {usedInProjects.map((project) => (
                    <Badge key={project.id} variant="outline" className="text-xs font-normal">
                      {project.name}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
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
