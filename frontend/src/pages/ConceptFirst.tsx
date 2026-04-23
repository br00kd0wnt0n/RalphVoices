import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { tests as testsApi, projects as projectsApi, personas as personasApi, uploads as uploadsApi } from '@/lib/api';
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
import { CheckCircle, Users, AlertCircle, GitCompare, Focus, Upload, X, FileText, Loader2, Sparkles, ArrowLeft, ArrowRight, Plus, RefreshCw } from 'lucide-react';
import { PersonaBuilder } from '@/components/PersonaBuilder';
import { TEST_FOCUS_PRESETS, type FocusPresetKey } from '@/lib/constants';
import type { Project, Persona } from '@/types';

interface UploadedAsset {
  name: string;
  mimeType: string;
  base64: string;
  isImage: boolean;
  isPDF: boolean;
  extractedText?: string;
  size: number;
}

interface ConceptFirstProps {
  retryTestId?: string;
}

export function ConceptFirst({ retryTestId }: ConceptFirstProps = {}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [retryLoading, setRetryLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Shows a small banner in step 1 once a Narrativ handoff has been detected
  // and pre-filled into the form.
  const [narrativHandoff, setNarrativHandoff] = useState<{ concept: string } | null>(null);

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

  // Step 1: Context (optional)
  const [creativeAmbition, setCreativeAmbition] = useState('');
  const [strategicTruth, setStrategicTruth] = useState('');
  const [insights, setInsights] = useState('');

  // Step 2: Audiences
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);
  const [projectIdForPersonas, setProjectIdForPersonas] = useState('__all__');
  const [showPersonaBuilder, setShowPersonaBuilder] = useState(false);

  // Step 3: Config
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [focusPreset, setFocusPreset] = useState<FocusPresetKey>('baseline');
  const [variantsPerPersona, setVariantsPerPersona] = useState(20);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);

  useEffect(() => {
    projectsApi.list().then(setProjects).catch(console.error);
  }, []);

  // Narrativ (Brainstorm) concept handoff. When Narrativ navigates the user
  // to /tests/new with source=narrativ and a concept payload, pre-fill the
  // concept form so the user can review/edit in step 1 and continue to
  // audience selection without retyping. URL is cleaned after extraction so
  // refreshes don't stash stale params on the form.
  useEffect(() => {
    if (searchParams.get('source') !== 'narrativ') return;
    const concept = searchParams.get('concept') || '';
    const statement = searchParams.get('statement') || '';
    const audience = searchParams.get('audience') || '';
    const angle = searchParams.get('angle') || '';
    const hypothesesRaw = searchParams.get('hypotheses') || '';

    let hypotheses: string[] = [];
    try {
      const parsed = JSON.parse(hypothesesRaw);
      if (Array.isArray(parsed)) hypotheses = parsed.filter((h) => typeof h === 'string' && h.trim());
    } catch { /* ignore malformed */ }

    // Concept text: title + statement form the main pitch the personas react to.
    const conceptBody = [concept, statement].filter(Boolean).join('\n\n');
    if (conceptBody) setConceptText(conceptBody);
    if (concept) setName(concept);

    // Strategic context fields map: angle -> Creative Ambition, audience -> Key Insight.
    // Strategic Truth is left empty for the user to own (it's often the result of the test).
    if (angle) setCreativeAmbition(angle);
    if (audience || hypotheses.length) {
      const insightsParts: string[] = [];
      if (audience) insightsParts.push(`Target audience: ${audience}`);
      if (hypotheses.length) {
        insightsParts.push('Testing hypotheses:\n' + hypotheses.map((h) => `- ${h}`).join('\n'));
      }
      setInsights(insightsParts.join('\n\n'));
    }

    setNarrativHandoff({ concept: concept || 'Narrativ concept' });

    // Clean the URL so params don't linger. Keep mode if it was set.
    const cleaned = new URLSearchParams();
    const mode = searchParams.get('mode');
    if (mode) cleaned.set('mode', mode);
    setSearchParams(cleaned, { replace: true });
  }, [searchParams, setSearchParams]);

  // Load test data when retrying a failed test
  useEffect(() => {
    if (!retryTestId) return;
    setRetryLoading(true);
    testsApi.get(retryTestId).then((data) => {
      const test = data.test || data;
      // Step 1: Concept
      if (test.concept_text) setConceptText(test.concept_text);
      if (test.name) setName(test.name.replace(/ - Concept [AB]$/, ''));

      // Parse options for assets and strategic context
      const opts = typeof test.options === 'string' ? JSON.parse(test.options) : (test.options || {});
      if (opts.assets?.length) setAssets(opts.assets);
      if (opts.strategic_context) {
        if (opts.strategic_context.creative_ambition) setCreativeAmbition(opts.strategic_context.creative_ambition);
        if (opts.strategic_context.strategic_truth) setStrategicTruth(opts.strategic_context.strategic_truth);
        if (opts.strategic_context.key_insight) setInsights(opts.strategic_context.key_insight);
      }

      // Step 2: Personas
      if (test.persona_ids?.length) setSelectedPersonaIds(test.persona_ids);

      // Step 3: Config
      if (test.project_id) setProjectId(test.project_id);
      const vc = typeof test.variant_config === 'string' ? JSON.parse(test.variant_config) : (test.variant_config || {});
      if (vc.focus_preset) setFocusPreset(vc.focus_preset as FocusPresetKey);
      if (test.variants_per_persona) setVariantsPerPersona(test.variants_per_persona);
    }).catch((err) => {
      console.error('Failed to load test for retry:', err);
    }).finally(() => {
      setRetryLoading(false);
    });
  }, [retryTestId]);

  useEffect(() => {
    if (projectIdForPersonas === '__all__') {
      personasApi.list().then((all) => {
        // Deduplicate by name — keep the one with the most variants
        const byName = new Map<string, Persona>();
        for (const p of all) {
          const existing = byName.get(p.name);
          if (!existing || (Number(p.variant_count) || 0) > (Number(existing.variant_count) || 0)) {
            byName.set(p.name, p);
          }
        }
        setPersonas(Array.from(byName.values()));
      }).catch(console.error);
    } else if (projectIdForPersonas) {
      personasApi.list(projectIdForPersonas).then(setPersonas).catch(console.error);
    }
  }, [projectIdForPersonas]);

  // Auto-show project creation if no projects exist at step 3
  useEffect(() => {
    if (step === 3 && projects.length === 0) {
      setShowCreateProject(true);
    }
  }, [step, projects.length]);


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

  const totalSelected = selectedPersonaIds.length;

  async function handleCreateProject() {
    if (!newProjectName.trim()) return;
    setCreatingProject(true);
    try {
      const project = await projectsApi.create({ name: newProjectName.trim() });
      setProjects((prev) => [...prev, project]);
      setProjectId(project.id);
      setShowCreateProject(false);
      setNewProjectName('');
    } catch (err: any) {
      setError(err.message || 'Failed to create project');
    } finally {
      setCreatingProject(false);
    }
  }

  async function handleRun() {
    if (!projectId || !name || totalSelected === 0) {
      if (!projectId) setError('Please select or create a project');
      else if (!name) setError('Please enter a test name');
      else setError('Please select at least one audience');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const allPersonaIds = [...selectedPersonaIds];
      const focusModifier = TEST_FOCUS_PRESETS[focusPreset]?.promptModifier || '';
      const currentAssets = testType === 'ab' ? assetsA : assets;

      if (testType === 'ab') {
        // Build strategic context
        const strategicContext = {
          ...(creativeAmbition ? { creative_ambition: creativeAmbition } : {}),
          ...(strategicTruth ? { strategic_truth: strategicTruth } : {}),
          ...(insights ? { key_insight: insights } : {}),
        };

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
            strategic_context: Object.keys(strategicContext).length > 0 ? strategicContext : undefined,
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
            strategic_context: Object.keys(strategicContext).length > 0 ? strategicContext : undefined,
          }),
        ]);

        await Promise.all([testsApi.run(testA.id), testsApi.run(testB.id)]);
        navigate(`/tests/${testA.id}`);
      } else {
        // Build strategic context
        const strategicContext = {
          ...(creativeAmbition ? { creative_ambition: creativeAmbition } : {}),
          ...(strategicTruth ? { strategic_truth: strategicTruth } : {}),
          ...(insights ? { key_insight: insights } : {}),
        };

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
          strategic_context: Object.keys(strategicContext).length > 0 ? strategicContext : undefined,
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

  const canProceedStep1 = testType === 'ab'
    ? conceptText.length > 0 && conceptTextB.length > 0
    : conceptText.length > 0;

  const canProceedStep2 = totalSelected > 0;

  const canRun = projectId && name && totalSelected > 0;

  if (retryLoading) {
    return (
      <div className="max-w-3xl mx-auto flex items-center justify-center py-24">
        <div className="text-center space-y-3">
          <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Loading test data for editing...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">{retryTestId ? 'Edit & Retry Test' : 'Test a Concept'}</h1>
        <p className="text-muted-foreground mt-1">
          {retryTestId
            ? 'Review and adjust your test setup, then re-run.'
            : 'Upload your concept, select an audience, and get feedback in minutes.'}
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
            {i > 0 && (
              <div className={`w-8 h-0.5 transition-colors duration-500 ${step > i ? 'bg-[#D94D8F]/40' : 'bg-muted'}`} />
            )}
            <motion.div
              layout
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-all duration-300 ${
                step === s.num
                  ? 'bg-[#D94D8F] text-white shadow-md shadow-[#D94D8F]/20'
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
            </motion.div>
          </div>
        ))}
      </div>

      {/* Step Content with animations */}
      <AnimatePresence mode="wait">
      {/* Step 1: Concept Input */}
      {step === 1 && (
        <motion.div
          key="step1"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          {narrativHandoff && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-[#D94D8F]/30 bg-[#D94D8F]/5 px-4 py-2.5">
              <div className="flex items-center gap-2 text-sm">
                <Sparkles className="h-4 w-4 text-[#D94D8F]" />
                <span className="text-foreground">
                  Pre-filled from Narrativ: <span className="font-medium">{narrativHandoff.concept}</span>
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setNarrativHandoff(null)}
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
              >
                Dismiss
              </Button>
            </div>
          )}

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
                <Label>Attach visuals or documents (optional)</Label>
                <p className="text-xs text-muted-foreground">Images are analysed visually by each persona using AI vision</p>
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

              {/* Strategic Context (optional) */}
              <div className="space-y-3 pt-2 border-t border-border/50">
                <p className="text-sm font-medium text-muted-foreground">Strategic Context (optional)</p>
                <div className="space-y-2">
                  <Label>Creative Ambition</Label>
                  <Input
                    value={creativeAmbition}
                    onChange={(e) => setCreativeAmbition(e.target.value)}
                    placeholder="e.g., Reposition the brand as a lifestyle choice for Gen Z"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Strategic Truth</Label>
                  <Input
                    value={strategicTruth}
                    onChange={(e) => setStrategicTruth(e.target.value)}
                    placeholder="e.g., Consumers want convenience but won't sacrifice quality"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Key Insight</Label>
                  <Input
                    value={insights}
                    onChange={(e) => setInsights(e.target.value)}
                    placeholder="e.g., 73% of our audience discovers brands through short-form video"
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
            <Button onClick={() => setStep(2)} disabled={!canProceedStep1} className="gap-2 transition-all hover:scale-[1.02]">
              Next: Select Audience <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </motion.div>
      )}

      {/* Step 2: Audience Selection */}
      {step === 2 && (
        <motion.div
          key="step2"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          {/* Personas */}
          <div className="space-y-3">
            <h3 className="font-semibold">Your Existing Personas</h3>

            <div className="flex items-center gap-3">
              <Select value={projectIdForPersonas || '__all__'} onValueChange={(v) => setProjectIdForPersonas(v)}>
                <SelectTrigger className="w-[280px]">
                  <SelectValue placeholder="Filter by project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Personas</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
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
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="font-medium text-sm truncate">{persona.name}</h4>
                            {persona.project_name && projectIdForPersonas === '__all__' && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                                {persona.project_name}
                              </Badge>
                            )}
                            {!persona.project_id && projectIdForPersonas === '__all__' && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                                Standalone
                              </Badge>
                            )}
                          </div>
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
              <p className="text-sm text-muted-foreground">
                {projectIdForPersonas === '__all__' ? 'No personas yet. Create one to get started.' : 'No personas in this project yet.'}
              </p>
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
              if (projectIdForPersonas === '__all__') {
                personasApi.list().then(setPersonas).catch(console.error);
              } else if (projectIdForPersonas) {
                personasApi.list(projectIdForPersonas).then(setPersonas).catch(console.error);
              }
            }}
            defaultProjectId={projectIdForPersonas === '__all__' ? undefined : projectIdForPersonas || undefined}
            prefillFromGwi={undefined}
          />
        </motion.div>
      )}

      {/* Step 3: Configure & Run */}
      {step === 3 && (
        <motion.div
          key="step3"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
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
              {showCreateProject ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="New project name"
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
                    autoFocus
                  />
                  <Button size="sm" onClick={handleCreateProject} disabled={creatingProject || !newProjectName.trim()}>
                    {creatingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowCreateProject(false)}>Cancel</Button>
                </div>
              ) : (
                <Select value={projectId} onValueChange={(v) => {
                  if (v === '__create__') {
                    setShowCreateProject(true);
                  } else {
                    setProjectId(v);
                  }
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                    <SelectItem value="__create__">
                      <span className="flex items-center gap-1 text-[#D94D8F]">
                        <Plus className="h-3 w-3" /> Create New Project
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
              {projects.length === 0 && !showCreateProject && (
                <p className="text-xs text-amber-600">No projects yet — create one to continue</p>
              )}
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
              className="bg-[#D94D8F] hover:bg-[#D94D8F]/90 gap-2 px-6 h-11 rounded-xl shadow-lg shadow-[#D94D8F]/20 transition-all hover:shadow-xl hover:shadow-[#D94D8F]/30 hover:scale-[1.02] disabled:shadow-none disabled:scale-100"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Running test...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Run Test
                </>
              )}
            </Button>
          </div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}
