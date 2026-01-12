import { useState } from 'react';
import { personas as personasApi, projects as projectsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
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
import { useEffect } from 'react';
import type { Project } from '@/types';

interface PersonaBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  defaultProjectId?: string;
}

export function PersonaBuilder({ open, onOpenChange, onCreated, defaultProjectId }: PersonaBuilderProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);

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
        project_id: projectId,
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

  const totalSteps = 4;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Persona</DialogTitle>
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
                <Label htmlFor="project">Project *</Label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
            </>
          )}
        </div>

        {/* Navigation */}
        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={() => step > 1 ? setStep(step - 1) : onOpenChange(false)}
          >
            {step > 1 ? 'Back' : 'Cancel'}
          </Button>
          <div className="flex gap-2">
            {step < totalSteps ? (
              <Button
                onClick={() => setStep(step + 1)}
                disabled={step === 1 && (!projectId || !name)}
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
