import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Settings as SettingsIcon, Brain, Sparkles, BarChart3, MessageSquare, Info, Save, RotateCcw, Lock } from 'lucide-react';

// Default prompts used by the system
const DEFAULT_PROMPTS = {
  conceptTest: {
    name: 'Concept Test',
    description: 'Used when personas react to creative concepts',
    system: `You are embodying a specific persona to provide authentic feedback on a creative
concept. Respond as this person would - with their vocabulary, concerns,
enthusiasm level, and cultural frame of reference.

Your response should:
1. Give an immediate gut reaction (1-2 sentences)
2. Explain what you understood the concept to be
3. Share what resonates or doesn't resonate with you
4. Indicate whether you'd engage with or share this

Stay in character throughout. Be specific and authentic to this persona's worldview.

After your response, provide JSON with these fields:
- sentiment_score: 1-10 (how positive/negative is your overall reaction)
- engagement_likelihood: 1-10 (how likely would you engage with this)
- share_likelihood: 1-10 (would you share this with friends)
- comprehension_score: 1-10 (how well did you understand what this is about)
- reaction_tags: array of 2-4 tags from [excited, intrigued, confused, skeptical, amused, bored, annoyed, inspired, would_share, would_ignore, needs_more_info, feels_authentic, feels_forced, seen_before, fresh_take]`,
    icon: MessageSquare,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
  },
  variantGeneration: {
    name: 'Variant Generation',
    description: 'Used when creating diverse persona variants',
    system: `You are generating variant personas for audience testing. Given a base persona, create unique individual variants with controlled diversity.

You MUST respond with a JSON object containing a "variants" array. Each variant object should have:
- variant_name: string (first name that fits the demographic)
- age_actual: number (within age spread of base age)
- location_variant: string (specific city/neighborhood)
- attitude_score: number 1-10 (1=skeptic, 10=enthusiast)
- primary_platform: string (their main social platform)
- engagement_level: string (one of: heavy, moderate, light, lapsed)
- distinguishing_trait: string (one specific thing that makes them unique)
- voice_modifier: string (how their voice differs from base)`,
    icon: Sparkles,
    color: 'text-[#D94D8F]',
    bgColor: 'bg-[#D94D8F]/10',
  },
  themeAnalysis: {
    name: 'Theme Analysis',
    description: 'Used when analyzing patterns across responses',
    system: `You are analyzing audience feedback to extract patterns and themes. Given a set
of persona responses to a creative concept, identify:

1. Key positive themes (what's working)
2. Key concerns (what's not working)
3. Unexpected reactions (surprises worth noting)
4. 3-5 representative quotes that capture the range of reactions

Return as JSON:
{
  "positive_themes": [{"theme": "string", "frequency": number}],
  "concerns": [{"theme": "string", "frequency": number}],
  "unexpected": [{"theme": "string", "frequency": number}],
  "key_quotes": ["quote1", "quote2", ...]
}`,
    icon: BarChart3,
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
  },
  voiceSample: {
    name: 'Voice Sample',
    description: 'Used when generating persona voice calibration',
    system: `You are generating a voice sample for a synthetic persona. Write 2-3 paragraphs
showing how this person would naturally communicate - their vocabulary, sentence
structure, tone, and cultural references. This will be used to calibrate AI
responses when this persona reacts to creative concepts.`,
    icon: Brain,
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10',
  },
};

// Test focus presets
export const TEST_FOCUS_PRESETS = {
  baseline: {
    name: 'Baseline',
    description: 'General audience feedback covering all aspects',
    focusAreas: [],
    promptModifier: '',
  },
  brandPerception: {
    name: 'Brand Perception',
    description: 'Focus on brand association, trust, and recognition',
    focusAreas: ['brand trust', 'brand recall', 'brand fit', 'competitor comparison'],
    promptModifier: `
FOCUS AREAS FOR THIS TEST:
Pay special attention to:
- How does this concept affect your perception of the brand?
- Does this feel authentic to what you know about this brand?
- Would this make you trust the brand more or less?
- How does this compare to similar brands you know?`,
  },
  purchaseIntent: {
    name: 'Purchase Intent',
    description: 'Focus on buying likelihood and barriers',
    focusAreas: ['purchase likelihood', 'price sensitivity', 'barriers to purchase', 'urgency'],
    promptModifier: `
FOCUS AREAS FOR THIS TEST:
Pay special attention to:
- Would this make you want to buy/try this product or service?
- What would stop you from purchasing?
- Does the value proposition feel compelling?
- How urgently would you want to act on this?`,
  },
  creativeImpact: {
    name: 'Creative Impact',
    description: 'Focus on emotional resonance and memorability',
    focusAreas: ['emotional response', 'memorability', 'distinctiveness', 'attention-grabbing'],
    promptModifier: `
FOCUS AREAS FOR THIS TEST:
Pay special attention to:
- What emotions does this concept trigger in you?
- Would you remember this tomorrow? Next week?
- What makes this stand out from similar content you've seen?
- Did this capture and hold your attention?`,
  },
  messageClarity: {
    name: 'Message Clarity',
    description: 'Focus on comprehension and takeaways',
    focusAreas: ['key message', 'comprehension', 'confusion points', 'call to action'],
    promptModifier: `
FOCUS AREAS FOR THIS TEST:
Pay special attention to:
- What is the main message you're taking away?
- Was anything confusing or unclear?
- What action (if any) are you being asked to take?
- Can you explain this concept to someone else?`,
  },
  socialShareability: {
    name: 'Social Shareability',
    description: 'Focus on viral potential and conversation',
    focusAreas: ['share likelihood', 'conversation starter', 'social currency', 'platform fit'],
    promptModifier: `
FOCUS AREAS FOR THIS TEST:
Pay special attention to:
- Would you share this on your social platforms? Which ones?
- Would this start a conversation with your friends?
- Does sharing this make you look good/smart/funny?
- What platform would this work best on?`,
  },
};

export function Settings() {
  const [activeTab, setActiveTab] = useState('prompts');
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [promptEdits, setPromptEdits] = useState<Record<string, string>>({});

  const handleSavePrompt = (key: string) => {
    // In the future, this would save to the backend
    console.log('Saving prompt:', key, promptEdits[key]);
    setEditingPrompt(null);
  };

  const handleResetPrompt = (key: string) => {
    setPromptEdits((prev) => {
      const updated = { ...prev };
      delete updated[key];
      return updated;
    });
    setEditingPrompt(null);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <SettingsIcon className="h-8 w-8 text-[#D94D8F]" />
          Settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Configure AI prompts and test focus areas
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="prompts">AI Prompts</TabsTrigger>
          <TabsTrigger value="presets">Test Focus Presets</TabsTrigger>
        </TabsList>

        <TabsContent value="prompts" className="space-y-4 mt-4">
          <div className="flex items-start gap-2 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <Info className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-blue-500">About AI Prompts</p>
              <p className="text-muted-foreground mt-1">
                These prompts control how the AI personas behave. Editing them can significantly affect
                the quality and consistency of feedback. The default prompts have been carefully tuned
                for optimal results.
              </p>
            </div>
          </div>

          {Object.entries(DEFAULT_PROMPTS).map(([key, prompt]) => {
            const Icon = prompt.icon;
            const isEditing = editingPrompt === key;
            const currentValue = promptEdits[key] ?? prompt.system;

            return (
              <Card key={key}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-xl ${prompt.bgColor}`}>
                        <Icon className={`h-5 w-5 ${prompt.color}`} />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{prompt.name}</CardTitle>
                        <CardDescription>{prompt.description}</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {promptEdits[key] && (
                        <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                          Modified
                        </Badge>
                      )}
                      <Badge variant="secondary" className="flex items-center gap-1">
                        <Lock className="h-3 w-3" />
                        Read-only
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>System Prompt</Label>
                    <Textarea
                      value={currentValue}
                      onChange={(e) =>
                        setPromptEdits((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      disabled={!isEditing}
                      className="min-h-[200px] font-mono text-sm"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      {currentValue.length} characters
                    </p>
                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleResetPrompt(key)}
                          >
                            <RotateCcw className="h-4 w-4 mr-1" />
                            Reset
                          </Button>
                          <Button size="sm" onClick={() => handleSavePrompt(key)} disabled>
                            <Save className="h-4 w-4 mr-1" />
                            Save (Coming Soon)
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingPrompt(key)}
                          disabled
                        >
                          Edit Prompt (Coming Soon)
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="presets" className="space-y-4 mt-4">
          <div className="flex items-start gap-2 p-4 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <Info className="h-5 w-5 text-purple-500 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-purple-500">About Test Focus Presets</p>
              <p className="text-muted-foreground mt-1">
                Focus presets add specific areas of inquiry to your concept tests. When you select
                a preset during test creation, the AI will pay extra attention to those aspects
                while still providing general feedback.
              </p>
            </div>
          </div>

          <div className="grid gap-4">
            {Object.entries(TEST_FOCUS_PRESETS).map(([key, preset]) => (
              <Card key={key} className={key === 'baseline' ? 'border-[#D94D8F]/50' : ''}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-lg">{preset.name}</h3>
                        {key === 'baseline' && (
                          <Badge className="bg-[#D94D8F]">Default</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{preset.description}</p>
                      {preset.focusAreas.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-3">
                          {preset.focusAreas.map((area) => (
                            <Badge key={area} variant="outline" className="text-xs">
                              {area}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {preset.promptModifier && (
                    <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                      <p className="text-xs font-medium text-muted-foreground mb-2">
                        Prompt Modifier:
                      </p>
                      <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">
                        {preset.promptModifier.trim()}
                      </pre>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
