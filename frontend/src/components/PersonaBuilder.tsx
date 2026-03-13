import { useState, useEffect } from 'react';
import { personas as personasApi, projects as projectsApi, gwi as gwiApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Globe, CheckCircle, AlertCircle, Lightbulb, RefreshCw } from 'lucide-react';
import type { Project } from '@/types';
import type { GwiAudience, GwiValidation } from '@/types/gwi';
import { GwiBadge } from './GwiBadge';
import { useGwi } from '@/hooks/useGwi';

interface PersonaBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  defaultProjectId?: string;
  prefillFromGwi?: GwiAudience;
}

export function PersonaBuilder({ open, onOpenChange, onCreated, defaultProjectId, prefillFromGwi }: PersonaBuilderProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [validation, setValidation] = useState<GwiValidation | null>(null);
  const [validating, setValidating] = useState(false);
  const gwiStatus = useGwi();

  // Form state
  const [projectId, setProjectId] = useState(defaultProjectId || '');
  const [name, setName] = useState('');
  const [ageBase, setAgeBase] = useState('');
  const [location, setLocation] = useState('');
  const [occupation, setOccupation] = useState('');
  const [household, setHousehold] = useState('');

  // Psychographics
  const [values, setValues] = useState('');
  const [motivations, setMotivations] = useState('');
  const [aspirations, setAspirations] = useState('');
  const [painPoints, setPainPoints] = useState('');
  const [decisionStyle, setDecisionStyle] = useState('');

  // Media habits
  const [platforms, setPlatforms] = useState('');
  const [contentPreferences, setContentPreferences] = useState('');
  const [influencerAffinities, setInfluencerAffinities] = useState('');

  // Cultural context
  const [subcultures, setSubcultures] = useState('');
  const [humorStyle, setHumorStyle] = useState('');
  const [languageMarkers, setLanguageMarkers] = useState('');

  useEffect(() => {
    if (open) {
      projectsApi.list().then(setProjects).catch(console.error);
    }
  }, [open]);

  useEffect(() => {
    if (defaultProjectId) {
      setProjectId(defaultProjectId);
    }
  }, [defaultProjectId]);

  // Pre-fill from GWI audience data
  useEffect(() => {
    if (prefillFromGwi && open) {
      setName(prefillFromGwi.name || '');
      if (prefillFromGwi.demographics?.age_range) {
        const match = prefillFromGwi.demographics.age_range.match(/(\d+)/);
        if (match) setAgeBase(match[1]);
      }
      if (prefillFromGwi.demographics?.top_locations?.length) {
        setLocation(prefillFromGwi.demographics.top_locations[0]);
      }
      if (prefillFromGwi.media_habits?.top_platforms?.length) {
        setPlatforms(prefillFromGwi.media_habits.top_platforms.join(', '));
      }
      if (prefillFromGwi.media_habits?.content_affinities?.length) {
        setContentPreferences(prefillFromGwi.media_habits.content_affinities.join(', '));
      }
      if (prefillFromGwi.psychographics?.values?.length) {
        setValues(prefillFromGwi.psychographics.values.join(', '));
      }
      if (prefillFromGwi.psychographics?.interests?.length) {
        setSubcultures(prefillFromGwi.psychographics.interests.join(', '));
      }
    }
  }, [prefillFromGwi, open]);

  function resetForm() {
    setStep(1);
    setName('');
    setAgeBase('');
    setLocation('');
    setOccupation('');
    setHousehold('');
    setValues('');
    setMotivations('');
    setAspirations('');
    setPainPoints('');
    setDecisionStyle('');
    setPlatforms('');
    setContentPreferences('');
    setInfluencerAffinities('');
    setSubcultures('');
    setHumorStyle('');
    setLanguageMarkers('');
    setValidation(null);
    setValidating(false);
  }

  async function handleSubmit() {
    setLoading(true);
    try {
      const parsePlatforms = (str: string) => {
        return str.split(',').map((p) => p.trim()).filter(Boolean).map((name) => ({
          name,
          hours_per_day: 1,
        }));
      };

      const parseList = (str: string) =>
        str.split(',').map((s) => s.trim()).filter(Boolean);

      await personasApi.create({
        project_id: projectId || undefined,
        name,
        age_base: ageBase ? parseInt(ageBase) : undefined,
        location: location || undefined,
        occupation: occupation || undefined,
        household: household || undefined,
        psychographics: {
          values: parseList(values),
          motivations: parseList(motivations),
          aspirations: parseList(aspirations),
          pain_points: parseList(painPoints),
          decision_style: decisionStyle || undefined,
        },
        media_habits: {
          primary_platforms: parsePlatforms(platforms),
          content_preferences: parseList(contentPreferences),
          influencer_affinities: parseList(influencerAffinities),
        },
        cultural_context: {
          subcultures: parseList(subcultures),
          humor_style: humorStyle || undefined,
          language_markers: parseList(languageMarkers),
        },
        gwi_audience_data: prefillFromGwi || undefined,
        generate_voice: true,
      });

      resetForm();
      onOpenChange(false);
      onCreated();
    } catch (error) {
      console.error('Failed to create persona:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleValidate() {
    setValidating(true);
    setValidation(null);
    try {
      const parseList = (str: string) =>
        str.split(',').map((s) => s.trim()).filter(Boolean);

      const result = await gwiApi.validatePersona({
        persona: {
          name,
          age_base: ageBase ? parseInt(ageBase) : null,
          location: location || null,
          occupation: occupation || null,
          psychographics: {
            values: parseList(values),
            motivations: parseList(motivations),
            aspirations: parseList(aspirations),
            pain_points: parseList(painPoints),
            decision_style: decisionStyle || undefined,
          },
          media_habits: {
            primary_platforms: platforms.split(',').map((p) => p.trim()).filter(Boolean).map((n) => ({ name: n, hours_per_day: 1 })),
            content_preferences: parseList(contentPreferences),
            influencer_affinities: parseList(influencerAffinities),
          },
        },
      });
      if (result.validation) {
        setValidation(result.validation);
      }
    } catch (err) {
      console.error('Failed to validate persona:', err);
    } finally {
      setValidating(false);
    }
  }

  const totalSteps = 4;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Create Persona
            {prefillFromGwi && <GwiBadge />}
          </DialogTitle>
          <DialogDescription>
            Step {step} of {totalSteps}: {
              step === 1 ? 'Basic Identity' :
              step === 2 ? 'Psychographics' :
              step === 3 ? 'Media Habits' :
              'Cultural Context'
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Step 1: Basic Identity */}
          {step === 1 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="project">Project</Label>
                <Select value={projectId || '__none__'} onValueChange={(v) => setProjectId(v === '__none__' ? '' : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="No project (standalone)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No project (standalone)</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Optional — personas can be added to projects later</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Persona Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Urban Millennial Professional"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="age">Age</Label>
                  <Input
                    id="age"
                    type="number"
                    value={ageBase}
                    onChange={(e) => setAgeBase(e.target.value)}
                    placeholder="e.g., 28"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="location">Location</Label>
                  <Input
                    id="location"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g., Brooklyn, NY"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="occupation">Occupation</Label>
                  <Input
                    id="occupation"
                    value={occupation}
                    onChange={(e) => setOccupation(e.target.value)}
                    placeholder="e.g., UX Designer"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="household">Household</Label>
                  <Input
                    id="household"
                    value={household}
                    onChange={(e) => setHousehold(e.target.value)}
                    placeholder="e.g., Lives with partner"
                  />
                </div>
              </div>
            </>
          )}

          {/* Step 2: Psychographics */}
          {step === 2 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="values">Core Values</Label>
                <Input
                  id="values"
                  value={values}
                  onChange={(e) => setValues(e.target.value)}
                  placeholder="e.g., authenticity, sustainability, creativity"
                />
                <p className="text-xs text-muted-foreground">Separate with commas</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="motivations">Motivations</Label>
                <Input
                  id="motivations"
                  value={motivations}
                  onChange={(e) => setMotivations(e.target.value)}
                  placeholder="e.g., career growth, creative expression"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="aspirations">Aspirations</Label>
                <Input
                  id="aspirations"
                  value={aspirations}
                  onChange={(e) => setAspirations(e.target.value)}
                  placeholder="e.g., start own business, travel more"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="painPoints">Pain Points</Label>
                <Input
                  id="painPoints"
                  value={painPoints}
                  onChange={(e) => setPainPoints(e.target.value)}
                  placeholder="e.g., information overload, burnout"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="decisionStyle">Decision Style</Label>
                <Input
                  id="decisionStyle"
                  value={decisionStyle}
                  onChange={(e) => setDecisionStyle(e.target.value)}
                  placeholder="e.g., researches thoroughly, values peer recommendations"
                />
              </div>
            </>
          )}

          {/* Step 3: Media Habits */}
          {step === 3 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="platforms">Primary Platforms</Label>
                <Input
                  id="platforms"
                  value={platforms}
                  onChange={(e) => setPlatforms(e.target.value)}
                  placeholder="e.g., Instagram, TikTok, LinkedIn"
                />
                <p className="text-xs text-muted-foreground">Separate with commas</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="contentPreferences">Content Preferences</Label>
                <Input
                  id="contentPreferences"
                  value={contentPreferences}
                  onChange={(e) => setContentPreferences(e.target.value)}
                  placeholder="e.g., design inspiration, career advice, travel"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="influencerAffinities">Influencer Affinities</Label>
                <Input
                  id="influencerAffinities"
                  value={influencerAffinities}
                  onChange={(e) => setInfluencerAffinities(e.target.value)}
                  placeholder="e.g., design thought leaders, sustainability advocates"
                />
              </div>
            </>
          )}

          {/* Step 4: Cultural Context */}
          {step === 4 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="subcultures">Subcultures</Label>
                <Input
                  id="subcultures"
                  value={subcultures}
                  onChange={(e) => setSubcultures(e.target.value)}
                  placeholder="e.g., design community, coffee culture, indie music"
                />
                <p className="text-xs text-muted-foreground">Separate with commas</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="humorStyle">Humor Style</Label>
                <Input
                  id="humorStyle"
                  value={humorStyle}
                  onChange={(e) => setHumorStyle(e.target.value)}
                  placeholder="e.g., dry, appreciates absurdist memes"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="languageMarkers">Language Markers</Label>
                <Textarea
                  id="languageMarkers"
                  value={languageMarkers}
                  onChange={(e) => setLanguageMarkers(e.target.value)}
                  placeholder="e.g., uses 'lowkey', references niche memes, avoids corporate speak"
                />
              </div>

              {/* GWI Validation */}
              {gwiStatus.enabled && (
                <div className="mt-4 pt-4 border-t border-border/50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <GwiBadge />
                      <span className="text-sm font-medium">Market Validation</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleValidate}
                      disabled={validating || !name}
                      className="gap-2"
                    >
                      {validating ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Globe className="h-3.5 w-3.5" />
                      )}
                      {validating ? 'Validating...' : validation ? 'Re-validate' : 'Validate against market data'}
                    </Button>
                  </div>

                  {validation && (
                    <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/30 p-4">
                      {/* Match Score + Market Size */}
                      <div className="flex items-center gap-3">
                        <div className={`text-2xl font-bold ${
                          validation.match_score >= 70 ? 'text-green-600' :
                          validation.match_score >= 40 ? 'text-yellow-600' : 'text-red-600'
                        }`}>
                          {validation.match_score}
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Market Match Score</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge variant={
                              validation.match_score >= 70 ? 'success' :
                              validation.match_score >= 40 ? 'secondary' : 'destructive'
                            } className="text-xs">
                              {validation.match_score >= 70 ? 'Strong Match' :
                               validation.match_score >= 40 ? 'Moderate' : 'Weak Match'}
                            </Badge>
                            {validation.market_size_estimate && (
                              <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-600">
                                {validation.market_size_estimate}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Gaps */}
                      {validation.gaps.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-amber-700 flex items-center gap-1 mb-1">
                            <AlertCircle className="h-3 w-3" /> Gaps to Consider
                          </p>
                          <ul className="space-y-1">
                            {validation.gaps.map((gap, i) => (
                              <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                                <span className="text-amber-500 mt-0.5">•</span>
                                {gap}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Suggestions */}
                      {validation.suggestions.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-emerald-700 flex items-center gap-1 mb-1">
                            <Lightbulb className="h-3 w-3" /> Suggestions
                          </p>
                          <ul className="space-y-1">
                            {validation.suggestions.map((suggestion, i) => (
                              <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                                <span className="text-emerald-600 mt-0.5">•</span>
                                {suggestion}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {validation.gaps.length === 0 && validation.suggestions.length === 0 && (
                        <p className="text-xs text-emerald-700 flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" /> This persona aligns well with GWI market data
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Navigation */}
        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={() => {
              if (step > 1) {
                if (step === 4) { setValidation(null); setValidating(false); }
                setStep(step - 1);
              } else {
                onOpenChange(false);
              }
            }}
          >
            {step > 1 ? 'Back' : 'Cancel'}
          </Button>
          <div className="flex gap-2">
            {step < totalSteps ? (
              <Button
                onClick={() => setStep(step + 1)}
                disabled={step === 1 && !name}
              >
                Next
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={loading}>
                {loading ? 'Creating...' : 'Create Persona'}
              </Button>
            )}
          </div>
        </div>

        {/* Progress indicator */}
        <div className="flex gap-1 justify-center mt-4">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 w-8 rounded-full ${
                i + 1 <= step ? 'bg-primary' : 'bg-muted'
              }`}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
