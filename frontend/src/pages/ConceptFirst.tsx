import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { tests as testsApi, projects as projectsApi, personas as personasApi, uploads as uploadsApi, gwi as gwiApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { CheckCircle, Users, AlertCircle, GitCompare, Focus, Upload, X, FileText, Loader2, Sparkles, Globe, ArrowLeft, ArrowRight } from 'lucide-react';
import { GwiAudienceCard } from '@/components/GwiAudienceCard';
import { GwiBadge } from '@/components/GwiBadge';
import { PersonaBuilder } from '@/components/PersonaBuilder';
import { useGwi } from '@/hooks/useGwi';
import { TEST_FOCUS_PRESETS, type FocusPresetKey } from '@/lib/constants';
import type { Project, Persona } from '@/types';
import type { GwiAudience } from '@/types/gwi';

interface UploadedAsset {
  name: string;
  mimeType: string;
  base64: string;
  isImage: boolean;
  isPDF: boolean;
  extractedText?: string;
  size: number;
}

export function ConceptFirst() {
  const navigate = useNavigate();
  const { enabled: gwiEnabled } = useGwi();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [projects, setProjects] = useState<Project[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);

  // Step 1: Concept
  const [testType, setTestType] = useState<'concept' | 'ab'>('concept');
  const [conceptText, setConceptText] = useState('');
  const [conceptTextB, setConceptTextB] = useState('');
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const [assetsA, setAssetsA] = useState<UploadedAsset[]>([]);
  const [assetsB, setAssetsB] = useState<UploadedAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadingA, setUploadingA] = useState(false);
  const [uploadingB, setUploadingB] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputRefA = useRef<HTMLInputElement>(null);
  const fileInputRefB = useRef<HTMLInputElement>(null);

  // Step 2: Audiences
  const [gwiAudiences, setGwiAudiences] = useState<GwiAudience[]>([]);
  const [gwiLoading, setGwiLoading] = useState(false);
  const [selectedGwiAudiences, setSelectedGwiAudiences] = useState<number[]>([]);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);
  const [projectIdForPersonas, setProjectIdForPersonas] = useState('');
  const [showPersonaBuilder, setShowPersonaBuilder] = useState(false);
  const [prefillAudience, setPrefillAudience] = useState<GwiAudience | null>(null);

  // Step 3: Config
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [focusPreset, setFocusPreset] = useState<FocusPresetKey>('baseline');
  const [variantsPerPersona, setVariantsPerPersona] = useState(20);

  useEffect(() => {
    projectsApi.list().then(setProjects).catch(console.error);
  }, []);

  useEffect(() => {
    if (projectIdForPersonas) {
      personasApi.list(projectIdForPersonas).then(setPersonas).catch(console.error);
    }
  }, [projectIdForPersonas]);

  // Fetch GWI suggestions when moving to step 2
  useEffect(() => {
    if (step === 2 && gwiEnabled && conceptText.length >= 20 && gwiAudiences.length === 0 && !gwiLoading) {
      setGwiLoading(true);
      gwiApi.suggestAudiences({ concept_text: conceptText })
        .then((data) => {
          if (data.audiences) setGwiAudiences(data.audiences);
        })
        .catch(console.error)
        .finally(() => setGwiLoading(false));
    }
  }, [step, gwiEnabled, conceptText]);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>, target: 'single' | 'A' | 'B' = 'single') {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const setUploadingFn = target === 'A' ? setUploadingA : target === 'B' ? setUploadingB : setUploading;
    const setAssetsFn = target === 'A' ? setAssetsA : target === 'B' ? setAssetsB : setAssets;

    setUploadingFn(true);
    try {
      for (const file of Array.from(files)) {
        const result = await uploadsApi.upload(file);
        if (result.success && result.file) {
          setAssetsFn((prev) => [...prev, result.file]);
        }
      }
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploadingFn(false);
    }
  }

  function removeAsset(index: number, target: 'single' | 'A' | 'B' = 'single') {
    const setAssetsFn = target === 'A' ? setAssetsA : target === 'B' ? setAssetsB : setAssets;
    setAssetsFn((prev) => prev.filter((_, i) => i !== index));
  }

  function togglePersona(id: string) {
    setSelectedPersonaIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  function toggleGwiAudience(index: number) {
    setSelectedGwiAudiences((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  }

  const totalSelected = selectedPersonaIds.length + selectedGwiAudiences.length;

  async function handleRun() {
    if (!projectId || !name || totalSelected === 0) return;
    setLoading(true);
    setError('');

    try {
      // If GWI audiences are selected but not yet created as personas, create them first
      const allPersonaIds = [...selectedPersonaIds];

      for (const idx of selectedGwiAudiences) {
        const audience = gwiAudiences[idx];
        if (!audience) continue;

        // Create persona from GWI audience
        const persona = await personasApi.create({
          project_id: projectId,
          name: audience.name,
          age_base: parseAgeRange(audience.demographics.age_range),
          location: audience.demographics.top_locations[0] || undefined,
          psychographics: {
            values: audience.psychographics.values,
            motivations: [],
            aspirations: [],
            pain_points: [],
          },
          media_habits: {
            primary_platforms: audience.media_habits.top_platforms.map((name) => ({
              name,
              hours_per_day: 1,
            })),
            content_preferences: audience.media_habits.content_affinities,
          },
          cultural_context: {
            subcultures: [],
            language_markers: [],
          },
          gwi_audience_data: {
            source_audience: audience.name,
            market_size_percent: audience.size_percent,
            index_score: audience.index_score,
            raw_data: audience,
          },
          generate_voice: true,
        });

        // Generate variants for the new persona
        await personasApi.generateVariants(persona.id, {
          count: variantsPerPersona,
          age_spread: 5,
          attitude_distribution: 'normal',
          platforms_to_include: audience.media_habits.top_platforms.length > 0
            ? audience.media_habits.top_platforms
            : ['TikTok', 'Instagram', 'YouTube', 'Twitter/X'],
        });

        allPersonaIds.push(persona.id);
      }

      const focusModifier = TEST_FOCUS_PRESETS[focusPreset]?.promptModifier || '';
      const currentAssets = testType === 'ab' ? assetsA : assets;

      if (testType === 'ab') {
        // Create two tests
        const [testA, testB] = await Promise.all([
          testsApi.create({
            project_id: projectId,
            name: `${name} - Concept A`,
            test_type: 'concept',
            concept_text: conceptText,
            assets: assetsA,
            persona_ids: allPersonaIds,
            variants_per_persona: variantsPerPersona,
            focus_preset: focusPreset,
            focus_modifier: focusModifier,
          }),
          testsApi.create({
            project_id: projectId,
            name: `${name} - Concept B`,
            test_type: 'concept',
            concept_text: conceptTextB,
            assets: assetsB,
            persona_ids: allPersonaIds,
            variants_per_persona: variantsPerPersona,
            focus_preset: focusPreset,
            focus_modifier: focusModifier,
          }),
        ]);

        await Promise.all([testsApi.run(testA.id), testsApi.run(testB.id)]);
        navigate(`/tests/${testA.id}`);
      } else {
        const test = await testsApi.create({
          project_id: projectId,
          name,
          test_type: 'concept',
          concept_text: conceptText,
          assets: currentAssets,
          persona_ids: allPersonaIds,
          variants_per_persona: variantsPerPersona,
          focus_preset: focusPreset,
          focus_modifier: focusModifier,
        });

        await testsApi.run(test.id);
        navigate(`/tests/${test.id}`);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create and run test');
    } finally {
      setLoading(false);
    }
  }

  function parseAgeRange(range: string): number {
    const match = range.match(/(\d+)/);
    if (!match) return 30;
    const first = parseInt(match[1]);
    const secondMatch = range.match(/(\d+)\s*[-–]\s*(\d+)/);
    if (secondMatch) {
      return Math.round((parseInt(secondMatch[1]) + parseInt(secondMatch[2])) / 2);
    }
    return first;
  }

  const canProceedStep1 = testType === 'ab'
    ? conceptText.length > 0 && conceptTextB.length > 0
    : conceptText.length > 0;

  const canProceedStep2 = totalSelected > 0;

  const canRun = projectId && name && totalSelected > 0;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Test a Concept</h1>
        <p className="text-muted-foreground mt-1">
          Upload your concept, select an audience, and get feedback in minutes.
        </p>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-2">
        {[
          { num: 1, label: 'Concept' },
          { num: 2, label: 'Audience' },
          { num: 3, label: 'Configure & Run' },
        ].map((s, i) => (
          <div key={s.num} className="flex items-center gap-2">
            {i > 0 && <div className="w-8 h-0.5 bg-muted" />}
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
                step === s.num
                  ? 'bg-[#D94D8F] text-white'
                  : step > s.num
                  ? 'bg-[#D94D8F]/10 text-[#D94D8F]'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {step > s.num ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <span className="w-4 text-center">{s.num}</span>
              )}
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Step 1: Concept Input */}
      {step === 1 && (
        <div className="space-y-6">
          {/* Test Type */}
          <div className="grid grid-cols-2 gap-3">
            <Card
              className={`cursor-pointer transition-all ${testType === 'concept' ? 'border-[#D94D8F] bg-[#D94D8F]/5' : 'hover:border-muted-foreground/30'}`}
              onClick={() => setTestType('concept')}
            >
              <CardContent className="pt-4 pb-3 text-center">
                <Focus className="h-6 w-6 mx-auto mb-2 text-[#D94D8F]" />
                <p className="font-medium text-sm">Single Concept</p>
                <p className="text-xs text-muted-foreground">Test one idea</p>
              </CardContent>
            </Card>
            <Card
              className={`cursor-pointer transition-all ${testType === 'ab' ? 'border-[#D94D8F] bg-[#D94D8F]/5' : 'hover:border-muted-foreground/30'}`}
              onClick={() => setTestType('ab')}
            >
              <CardContent className="pt-4 pb-3 text-center">
                <GitCompare className="h-6 w-6 mx-auto mb-2 text-[#D94D8F]" />
                <p className="font-medium text-sm">A/B Compare</p>
                <p className="text-xs text-muted-foreground">Test two ideas</p>
              </CardContent>
            </Card>
          </div>

          {testType === 'concept' ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Describe your concept</Label>
                <Textarea
                  value={conceptText}
                  onChange={(e) => setConceptText(e.target.value)}
                  placeholder="Paste your concept, ad copy, product description, or creative brief..."
                  className="min-h-[150px]"
                />
                <p className="text-xs text-muted-foreground">{conceptText.length} characters</p>
              </div>

              {/* File uploads */}
              <div className="space-y-2">
                <Label>Attach files (optional)</Label>
                <div className="flex flex-wrap gap-2">
                  {assets.map((asset, i) => (
                    <Badge key={i} variant="secondary" className="flex items-center gap-1 pr-1">
                      {asset.isImage ? '🖼' : <FileText className="h-3 w-3" />}
                      <span className="max-w-[120px] truncate text-xs">{asset.name}</span>
                      <button onClick={() => removeAsset(i)} className="ml-1 hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
                    Upload
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => handleFileUpload(e)}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {/* Concept A */}
              <div className="space-y-3">
                <Label className="text-[#D94D8F] font-semibold">Concept A</Label>
                <Textarea
                  value={conceptText}
                  onChange={(e) => setConceptText(e.target.value)}
                  placeholder="First concept..."
                  className="min-h-[120px]"
                />
                <div className="flex flex-wrap gap-1">
                  {assetsA.map((asset, i) => (
                    <Badge key={i} variant="secondary" className="text-xs flex items-center gap-1 pr-1">
                      {asset.name.substring(0, 15)}
                      <button onClick={() => removeAsset(i, 'A')}><X className="h-3 w-3" /></button>
                    </Badge>
                  ))}
                  <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => fileInputRefA.current?.click()} disabled={uploadingA}>
                    {uploadingA ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                  </Button>
                  <input ref={fileInputRefA} type="file" accept="image/*,.pdf" multiple className="hidden" onChange={(e) => handleFileUpload(e, 'A')} />
                </div>
              </div>
              {/* Concept B */}
              <div className="space-y-3">
                <Label className="text-blue-500 font-semibold">Concept B</Label>
                <Textarea
                  value={conceptTextB}
                  onChange={(e) => setConceptTextB(e.target.value)}
                  placeholder="Second concept..."
                  className="min-h-[120px]"
                />
                <div className="flex flex-wrap gap-1">
                  {assetsB.map((asset, i) => (
                    <Badge key={i} variant="secondary" className="text-xs flex items-center gap-1 pr-1">
                      {asset.name.substring(0, 15)}
                      <button onClick={() => removeAsset(i, 'B')}><X className="h-3 w-3" /></button>
                    </Badge>
                  ))}
                  <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => fileInputRefB.current?.click()} disabled={uploadingB}>
                    {uploadingB ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                  </Button>
                  <input ref={fileInputRefB} type="file" accept="image/*,.pdf" multiple className="hidden" onChange={(e) => handleFileUpload(e, 'B')} />
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={() => setStep(2)} disabled={!canProceedStep1}>
              Next: Select Audience <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Audience Selection */}
      {step === 2 && (
        <div className="space-y-6">
          {/* GWI Suggestions */}
          {gwiEnabled && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-emerald-600" />
                <h3 className="font-semibold">Suggested Audiences</h3>
                <GwiBadge />
              </div>

              {gwiLoading ? (
                <Card>
                  <CardContent className="py-8 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-emerald-600" />
                    <p className="text-sm text-muted-foreground">Analyzing your concept with GWI Spark...</p>
                  </CardContent>
                </Card>
              ) : gwiAudiences.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {gwiAudiences.map((audience, index) => (
                    <GwiAudienceCard
                      key={index}
                      audience={audience}
                      selected={selectedGwiAudiences.includes(index)}
                      onToggle={() => toggleGwiAudience(index)}
                      onCreatePersona={() => {
                        setPrefillAudience(audience);
                        setShowPersonaBuilder(true);
                      }}
                    />
                  ))}
                </div>
              ) : (
                <Card>
                  <CardContent className="py-4 text-center">
                    <p className="text-sm text-muted-foreground">
                      No audience suggestions available. Try adding more detail to your concept.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Existing Personas */}
          <div className="space-y-3">
            <h3 className="font-semibold">Your Existing Personas</h3>

            <div className="flex items-center gap-3">
              <Select value={projectIdForPersonas} onValueChange={setProjectIdForPersonas}>
                <SelectTrigger className="w-[250px]">
                  <SelectValue placeholder="Select a project to load personas" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPrefillAudience(null);
                  setShowPersonaBuilder(true);
                }}
              >
                <Users className="h-4 w-4 mr-1" />
                Create New
              </Button>
            </div>

            {personas.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {personas.map((persona) => (
                  <Card
                    key={persona.id}
                    className={`cursor-pointer transition-all ${
                      selectedPersonaIds.includes(persona.id)
                        ? 'border-[#D94D8F] bg-[#D94D8F]/5'
                        : 'hover:border-muted-foreground/30'
                    }`}
                    onClick={() => togglePersona(persona.id)}
                  >
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-start gap-3">
                        <Checkbox checked={selectedPersonaIds.includes(persona.id)} className="mt-1" />
                        <div>
                          <h4 className="font-medium text-sm">{persona.name}</h4>
                          <p className="text-xs text-muted-foreground">
                            {[persona.age_base && `${persona.age_base}yo`, persona.location, persona.occupation]
                              .filter(Boolean).join(' · ')}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {Number(persona.variant_count) || 0} variants
                          </p>
                          {Number(persona.variant_count) === 0 && (
                            <div className="flex items-center gap-1 text-xs text-amber-600 mt-1">
                              <AlertCircle className="h-3 w-3" />
                              No variants — will be generated
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : projectIdForPersonas ? (
              <p className="text-sm text-muted-foreground">No personas in this project yet.</p>
            ) : null}
          </div>

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {totalSelected} audience{totalSelected !== 1 ? 's' : ''} selected
              </span>
              <Button onClick={() => setStep(3)} disabled={!canProceedStep2}>
                Next: Configure <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>

          <PersonaBuilder
            open={showPersonaBuilder}
            onOpenChange={setShowPersonaBuilder}
            onCreated={() => {
              if (projectIdForPersonas) {
                personasApi.list(projectIdForPersonas).then(setPersonas).catch(console.error);
              }
            }}
            defaultProjectId={projectIdForPersonas || undefined}
            prefillFromGwi={prefillAudience || undefined}
          />
        </div>
      )}

      {/* Step 3: Configure & Run */}
      {step === 3 && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Test Name *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={conceptText.substring(0, 50).split('\n')[0] || 'My concept test'}
              />
            </div>
            <div className="space-y-2">
              <Label>Project *</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Test Focus</Label>
              <Select value={focusPreset} onValueChange={(v) => setFocusPreset(v as FocusPresetKey)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TEST_FOCUS_PRESETS).map(([key, preset]) => (
                    <SelectItem key={key} value={key}>{preset.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {TEST_FOCUS_PRESETS[focusPreset]?.description}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Variants per Persona</Label>
              <Select
                value={variantsPerPersona.toString()}
                onValueChange={(v) => setVariantsPerPersona(parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 20, 30, 50].map((n) => (
                    <SelectItem key={n} value={n.toString()}>{n} variants</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Summary */}
          <Card className="bg-muted/50">
            <CardContent className="pt-4 pb-3">
              <h4 className="font-medium mb-2">Test Summary</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Type:</span>{' '}
                  {testType === 'ab' ? 'A/B Comparison' : 'Single Concept'}
                </div>
                <div>
                  <span className="text-muted-foreground">Audiences:</span> {totalSelected}
                </div>
                <div>
                  <span className="text-muted-foreground">Variants:</span>{' '}
                  {totalSelected * variantsPerPersona} total
                </div>
                <div>
                  <span className="text-muted-foreground">Focus:</span>{' '}
                  {TEST_FOCUS_PRESETS[focusPreset]?.name}
                </div>
              </div>
              {conceptText && (
                <div className="mt-3 p-2 bg-background rounded text-xs text-muted-foreground">
                  <p className="font-medium text-foreground mb-1">Concept preview:</p>
                  <p className="line-clamp-2">{conceptText}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
            <Button
              onClick={handleRun}
              disabled={!canRun || loading}
              className="bg-[#D94D8F] hover:bg-[#D94D8F]/90"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {selectedGwiAudiences.length > 0 ? 'Creating personas & running...' : 'Running test...'}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Run Test
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
