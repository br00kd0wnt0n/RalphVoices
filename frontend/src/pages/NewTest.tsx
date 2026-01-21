import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { tests as testsApi, projects as projectsApi, personas as personasApi, uploads as uploadsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, Circle, Users, AlertCircle, GitCompare, Focus, Upload, X, FileText, Loader2 } from 'lucide-react';
import type { Project, Persona } from '@/types';
import { TEST_FOCUS_PRESETS } from './Settings';

interface UploadedAsset {
  name: string;
  mimeType: string;
  base64: string;
  isImage: boolean;
  isPDF: boolean;
  extractedText?: string;
  size: number;
}

export function NewTest() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [projects, setProjects] = useState<Project[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);

  // Form state
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [testType, setTestType] = useState<'concept' | 'ab'>('concept');
  const [focusPreset, setFocusPreset] = useState<keyof typeof TEST_FOCUS_PRESETS>('baseline');
  const [conceptText, setConceptText] = useState('');
  const [conceptTextB, setConceptTextB] = useState(''); // For A/B testing
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);
  const [variantsPerPersona, setVariantsPerPersona] = useState(20);
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    projectsApi.list().then(setProjects).catch(console.error);
  }, []);

  useEffect(() => {
    if (projectId) {
      personasApi.list(projectId).then(setPersonas).catch(console.error);
    } else {
      setPersonas([]);
    }
    setSelectedPersonaIds([]);
  }, [projectId]);

  function togglePersona(id: string) {
    setSelectedPersonaIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const result = await uploadsApi.upload(file);
        if (result.success && result.file) {
          setAssets(prev => [...prev, result.file]);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to upload file');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  function removeAsset(index: number) {
    setAssets(prev => prev.filter((_, i) => i !== index));
  }

  async function handleCreateTest() {
    setLoading(true);
    setError('');

    try {
      const selectedPreset = TEST_FOCUS_PRESETS[focusPreset];

      if (testType === 'ab') {
        // Create two tests for A/B comparison
        const testA = await testsApi.create({
          project_id: projectId,
          name: `${name} - Concept A`,
          test_type: 'concept',
          concept_text: conceptText,
          assets: assets,
          persona_ids: selectedPersonaIds,
          variants_per_persona: variantsPerPersona,
          focus_preset: focusPreset,
          focus_modifier: selectedPreset.promptModifier,
          variant_config: {
            age_spread: 5,
            attitude_distribution: 'normal',
            platforms_to_include: ['TikTok', 'Instagram', 'YouTube', 'Twitter/X'],
          },
        });

        const testB = await testsApi.create({
          project_id: projectId,
          name: `${name} - Concept B`,
          test_type: 'concept',
          concept_text: conceptTextB,
          assets: assets, // Same assets for both
          persona_ids: selectedPersonaIds,
          variants_per_persona: variantsPerPersona,
          focus_preset: focusPreset,
          focus_modifier: selectedPreset.promptModifier,
          variant_config: {
            age_spread: 5,
            attitude_distribution: 'normal',
            platforms_to_include: ['TikTok', 'Instagram', 'YouTube', 'Twitter/X'],
          },
        });

        // Run both tests
        await Promise.all([
          testsApi.run(testA.id),
          testsApi.run(testB.id),
        ]);

        // Navigate to the first test (user can see both in tests list)
        navigate(`/tests/${testA.id}`);
      } else {
        const test = await testsApi.create({
          project_id: projectId,
          name,
          test_type: 'concept',
          concept_text: conceptText,
          assets: assets,
          persona_ids: selectedPersonaIds,
          variants_per_persona: variantsPerPersona,
          focus_preset: focusPreset,
          focus_modifier: selectedPreset.promptModifier,
          variant_config: {
            age_spread: 5,
            attitude_distribution: 'normal',
            platforms_to_include: ['TikTok', 'Instagram', 'YouTube', 'Twitter/X'],
          },
        });

        // Immediately run the test
        await testsApi.run(test.id);
        navigate(`/tests/${test.id}`);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create test');
    } finally {
      setLoading(false);
    }
  }

  const totalVariants = selectedPersonaIds.length * variantsPerPersona;
  const personasNeedingVariants = personas.filter(
    (p) => selectedPersonaIds.includes(p.id) && (p.variant_count || 0) === 0
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Create New Test</h1>
        <p className="text-muted-foreground mt-1">
          Test a concept against your synthetic audience panel
        </p>
      </div>

      {/* Step 1: Project & Name */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            {step > 1 ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <Circle className="h-5 w-5 text-primary" />
            )}
            Step 1: Test Setup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
            <Label htmlFor="name">Test Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Summer Campaign Concept A"
            />
          </div>
          <div className="space-y-2">
            <Label>Test Type</Label>
            <div className="grid grid-cols-2 gap-3">
              <div
                onClick={() => setTestType('concept')}
                className={`p-4 rounded-lg border cursor-pointer transition-all ${
                  testType === 'concept'
                    ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Circle className={`h-5 w-5 ${testType === 'concept' ? 'text-primary' : 'text-muted-foreground'}`} />
                  <div>
                    <p className="font-medium">Single Concept</p>
                    <p className="text-sm text-muted-foreground">Test one concept against your panel</p>
                  </div>
                </div>
              </div>
              <div
                onClick={() => setTestType('ab')}
                className={`p-4 rounded-lg border cursor-pointer transition-all ${
                  testType === 'ab'
                    ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <GitCompare className={`h-5 w-5 ${testType === 'ab' ? 'text-primary' : 'text-muted-foreground'}`} />
                  <div>
                    <p className="font-medium">A/B Comparison</p>
                    <p className="text-sm text-muted-foreground">Compare two concepts side by side</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Focus className="h-4 w-4 text-[#D94D8F]" />
              Test Focus
            </Label>
            <Select value={focusPreset} onValueChange={(v) => setFocusPreset(v as keyof typeof TEST_FOCUS_PRESETS)}>
              <SelectTrigger>
                <SelectValue placeholder="Select a focus area" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TEST_FOCUS_PRESETS).map(([key, preset]) => (
                  <SelectItem key={key} value={key}>
                    <div className="flex items-center gap-2">
                      <span>{preset.name}</span>
                      {key === 'baseline' && (
                        <Badge variant="secondary" className="text-xs ml-1">Default</Badge>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {TEST_FOCUS_PRESETS[focusPreset].description}
            </p>
            {TEST_FOCUS_PRESETS[focusPreset].focusAreas.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {TEST_FOCUS_PRESETS[focusPreset].focusAreas.map((area) => (
                  <Badge key={area} variant="outline" className="text-xs">
                    {area}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          {projectId && name && step === 1 && (
            <Button onClick={() => setStep(2)}>Continue</Button>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Select Personas */}
      {step >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              {step > 2 ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <Circle className="h-5 w-5 text-primary" />
              )}
              Step 2: Select Personas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {personas.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <Users className="h-8 w-8 mx-auto mb-2" />
                <p>No personas in this project. Create some first!</p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {personas.map((persona) => {
                    const isSelected = selectedPersonaIds.includes(persona.id);
                    const hasVariants = (persona.variant_count || 0) > 0;
                    return (
                      <div
                        key={persona.id}
                        onClick={() => togglePersona(persona.id)}
                        className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                          isSelected
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{persona.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {persona.age_base && `${persona.age_base} yo`}
                              {persona.location && ` • ${persona.location}`}
                              {persona.occupation && ` • ${persona.occupation}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {hasVariants ? (
                              <Badge variant="secondary">
                                {persona.variant_count} variants
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-yellow-600">
                                No variants
                              </Badge>
                            )}
                            <div
                              className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                                isSelected
                                  ? 'border-primary bg-primary'
                                  : 'border-muted-foreground'
                              }`}
                            >
                              {isSelected && (
                                <CheckCircle className="h-4 w-4 text-white" />
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {personasNeedingVariants.length > 0 && (
                  <div className="flex items-start gap-2 p-3 bg-yellow-50 rounded-lg text-yellow-800">
                    <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium">Some personas need variants</p>
                      <p>
                        {personasNeedingVariants.map((p) => p.name).join(', ')} need
                        variants generated before testing.
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="variants">Variants per persona:</Label>
                    <Select
                      value={variantsPerPersona.toString()}
                      onValueChange={(v) => setVariantsPerPersona(parseInt(v))}
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="20">20</SelectItem>
                        <SelectItem value="30">30</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    Total: {totalVariants} responses
                  </span>
                </div>

                {selectedPersonaIds.length > 0 && step === 2 && (
                  <Button onClick={() => setStep(3)}>Continue</Button>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 3: Concept Input */}
      {step >= 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Circle className="h-5 w-5 text-primary" />
              Step 3: {testType === 'ab' ? 'Enter Concepts to Compare' : 'Enter Concept'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {testType === 'ab' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="conceptA" className="flex items-center gap-2">
                    <Badge className="bg-blue-500">A</Badge>
                    Concept A *
                  </Label>
                  <Textarea
                    id="conceptA"
                    value={conceptText}
                    onChange={(e) => setConceptText(e.target.value)}
                    placeholder="Describe the first concept..."
                    className="min-h-[200px]"
                  />
                  <p className="text-xs text-muted-foreground">
                    {conceptText.length} characters
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="conceptB" className="flex items-center gap-2">
                    <Badge className="bg-purple-500">B</Badge>
                    Concept B *
                  </Label>
                  <Textarea
                    id="conceptB"
                    value={conceptTextB}
                    onChange={(e) => setConceptTextB(e.target.value)}
                    placeholder="Describe the second concept..."
                    className="min-h-[200px]"
                  />
                  <p className="text-xs text-muted-foreground">
                    {conceptTextB.length} characters
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="concept">Concept Description *</Label>
                <Textarea
                  id="concept"
                  value={conceptText}
                  onChange={(e) => setConceptText(e.target.value)}
                  placeholder="Describe the concept, ad, or creative idea you want to test. Be as detailed as needed - the personas will react to exactly what you write here."
                  className="min-h-[150px]"
                />
                <p className="text-xs text-muted-foreground">
                  {conceptText.length} characters
                </p>
              </div>
            )}

            {/* File Upload Section */}
            <div className="space-y-3 pt-4 border-t">
              <Label className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Attach Images or PDFs (optional)
              </Label>
              <p className="text-xs text-muted-foreground">
                Upload images or PDFs to include with your concept. The AI will analyze these along with your text.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
                multiple
                onChange={handleFileUpload}
                className="hidden"
              />

              <div className="flex flex-wrap gap-3">
                {assets.map((asset, index) => (
                  <div
                    key={index}
                    className="relative group border rounded-lg p-2 bg-muted/50"
                  >
                    {asset.isImage ? (
                      <div className="w-24 h-24 flex items-center justify-center">
                        <img
                          src={asset.base64}
                          alt={asset.name}
                          className="max-w-full max-h-full object-contain rounded"
                        />
                      </div>
                    ) : (
                      <div className="w-24 h-24 flex flex-col items-center justify-center text-muted-foreground">
                        <FileText className="h-8 w-8 mb-1" />
                        <span className="text-xs text-center truncate w-full px-1">
                          {asset.name}
                        </span>
                      </div>
                    )}
                    <button
                      onClick={() => removeAsset(index)}
                      className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-24 h-24 border-2 border-dashed rounded-lg flex flex-col items-center justify-center text-muted-foreground hover:text-primary hover:border-primary transition-colors"
                >
                  {uploading ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <>
                      <Upload className="h-6 w-6 mb-1" />
                      <span className="text-xs">Upload</span>
                    </>
                  )}
                </button>
              </div>

              {assets.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {assets.filter(a => a.isImage).length} image(s), {assets.filter(a => a.isPDF).length} PDF(s) attached
                </p>
              )}
            </div>

            {error && (
              <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                {selectedPersonaIds.length} persona(s) selected • {testType === 'ab' ? `${totalVariants * 2} responses (${totalVariants} per concept)` : `${totalVariants} responses`}
              </div>
              <Button
                onClick={handleCreateTest}
                disabled={
                  !conceptText ||
                  (testType === 'ab' && !conceptTextB) ||
                  loading ||
                  personasNeedingVariants.length > 0
                }
                size="lg"
              >
                {loading
                  ? (testType === 'ab' ? 'Running A/B Test...' : 'Creating & Running Test...')
                  : (testType === 'ab' ? 'Run A/B Test' : 'Run Test')
                }
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
