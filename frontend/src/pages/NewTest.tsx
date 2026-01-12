import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { tests as testsApi, projects as projectsApi, personas as personasApi } from '@/lib/api';
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
import { CheckCircle, Circle, Users, AlertCircle } from 'lucide-react';
import type { Project, Persona } from '@/types';

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
  const [conceptText, setConceptText] = useState('');
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);
  const [variantsPerPersona, setVariantsPerPersona] = useState(20);

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

  async function handleCreateTest() {
    setLoading(true);
    setError('');

    try {
      const test = await testsApi.create({
        project_id: projectId,
        name,
        test_type: 'concept',
        concept_text: conceptText,
        persona_ids: selectedPersonaIds,
        variants_per_persona: variantsPerPersona,
        variant_config: {
          age_spread: 5,
          attitude_distribution: 'normal',
          platforms_to_include: ['TikTok', 'Instagram', 'YouTube', 'Twitter/X'],
        },
      });

      // Immediately run the test
      await testsApi.run(test.id);
      navigate(`/tests/${test.id}`);
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
              Step 3: Enter Concept
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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

            {error && (
              <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                {selectedPersonaIds.length} persona(s) selected • {totalVariants} responses
              </div>
              <Button
                onClick={handleCreateTest}
                disabled={!conceptText || loading || personasNeedingVariants.length > 0}
                size="lg"
              >
                {loading ? 'Creating & Running Test...' : 'Run Test'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
