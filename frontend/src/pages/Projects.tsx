import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { projects as projectsApi, personas as personasApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Plus, FolderOpen, Users, TestTube, Trash2, ChevronRight, ChevronLeft, Copy } from 'lucide-react';
import type { Project, Persona } from '@/types';

export function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [allPersonas, setAllPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState<1 | 2>(1);
  const [newProjectName, setNewProjectName] = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadProjects();
    loadAllPersonas();
  }, []);

  async function loadAllPersonas() {
    try {
      const data = await personasApi.list();
      setAllPersonas(data);
    } catch (error) {
      console.error('Failed to load personas:', error);
    }
  }

  async function loadProjects() {
    try {
      const data = await projectsApi.list();
      setProjects(data);
    } catch (error) {
      console.error('Failed to load projects:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateProject(e?: React.FormEvent | React.MouseEvent) {
    e?.preventDefault();
    setCreating(true);
    try {
      await projectsApi.create({
        name: newProjectName,
        client_name: newClientName || undefined,
        copy_persona_ids: selectedPersonaIds.length > 0 ? selectedPersonaIds : undefined,
      });
      setNewProjectName('');
      setNewClientName('');
      setSelectedPersonaIds([]);
      setCreateStep(1);
      setIsCreateOpen(false);
      loadProjects();
      loadAllPersonas();
    } catch (error) {
      console.error('Failed to create project:', error);
    } finally {
      setCreating(false);
    }
  }

  function handleDialogClose(open: boolean) {
    if (!open) {
      setCreateStep(1);
      setNewProjectName('');
      setNewClientName('');
      setSelectedPersonaIds([]);
    }
    setIsCreateOpen(open);
  }

  function togglePersonaSelection(personaId: string) {
    setSelectedPersonaIds(prev =>
      prev.includes(personaId)
        ? prev.filter(id => id !== personaId)
        : [...prev, personaId]
    );
  }

  async function handleDeleteProject(id: string) {
    if (!confirm('Are you sure you want to delete this project?')) return;
    try {
      await projectsApi.delete(id);
      loadProjects();
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  }

  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Projects</h1>
          <p className="text-muted-foreground mt-1">
            Organize your personas and tests by client or campaign
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={handleDialogClose}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Project
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {createStep === 1 ? 'Create Project' : 'Add Personas'}
              </DialogTitle>
              <DialogDescription>
                {createStep === 1
                  ? 'Create a new project to organize your personas and tests'
                  : 'Select existing personas to copy into this project, or skip to create new ones'}
              </DialogDescription>
            </DialogHeader>

            {createStep === 1 ? (
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Project Name</Label>
                  <Input
                    id="name"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="e.g., Summer Campaign 2024"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client">Client Name (optional)</Label>
                  <Input
                    id="client"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    placeholder="e.g., Acme Corp"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4 py-4">
                {allPersonas.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Users className="h-10 w-10 mx-auto mb-3 opacity-50" />
                    <p>No existing personas found.</p>
                    <p className="text-sm">You can create new personas after the project is created.</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
                      <span>{selectedPersonaIds.length} selected</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedPersonaIds(
                          selectedPersonaIds.length === allPersonas.length
                            ? []
                            : allPersonas.map(p => p.id)
                        )}
                      >
                        {selectedPersonaIds.length === allPersonas.length ? 'Deselect All' : 'Select All'}
                      </Button>
                    </div>
                    <div className="max-h-[300px] overflow-y-auto space-y-2 border rounded-lg p-2">
                      {allPersonas.map((persona) => (
                        <div
                          key={persona.id}
                          className={`flex items-center gap-3 p-3 rounded-md cursor-pointer transition-colors ${
                            selectedPersonaIds.includes(persona.id)
                              ? 'bg-primary/10 border border-primary/30'
                              : 'hover:bg-muted border border-transparent'
                          }`}
                          onClick={() => togglePersonaSelection(persona.id)}
                        >
                          <Checkbox
                            checked={selectedPersonaIds.includes(persona.id)}
                            onCheckedChange={() => togglePersonaSelection(persona.id)}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{persona.name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {persona.occupation} • {persona.location}
                            </p>
                          </div>
                          {persona.variant_count && Number(persona.variant_count) > 0 && (
                            <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                              {persona.variant_count} variants
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Copy className="h-3 w-3" />
                      Selected personas will be copied to the new project
                    </p>
                  </>
                )}
              </div>
            )}

            <DialogFooter className="flex-col sm:flex-row gap-2">
              {createStep === 1 ? (
                <>
                  <Button type="button" variant="outline" onClick={() => handleDialogClose(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={!newProjectName.trim()}
                    onClick={() => setCreateStep(2)}
                  >
                    Next: Add Personas
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={() => setCreateStep(1)}>
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Back
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={creating}
                      onClick={handleCreateProject}
                    >
                      {creating ? 'Creating...' : 'Skip & Create Project'}
                    </Button>
                    <Button
                      type="button"
                      disabled={creating || selectedPersonaIds.length === 0}
                      onClick={handleCreateProject}
                    >
                      {creating ? 'Creating...' : `Create with ${selectedPersonaIds.length} Persona${selectedPersonaIds.length !== 1 ? 's' : ''}`}
                    </Button>
                  </div>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No projects yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first project to start organizing your work
            </p>
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <Card key={project.id} className="hover:border-primary/50 transition-colors">
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-lg">{project.name}</CardTitle>
                  {project.client_name && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {project.client_name}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => handleDeleteProject(project.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                  <div className="flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    <span>{project.persona_count || 0} personas</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <TestTube className="h-4 w-4" />
                    <span>{project.test_count || 0} tests</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link to={`/personas?project=${project.id}`} className="flex-1">
                    <Button variant="outline" className="w-full" size="sm">
                      View Personas
                    </Button>
                  </Link>
                  <Link to={`/tests?project=${project.id}`} className="flex-1">
                    <Button variant="outline" className="w-full" size="sm">
                      View Tests
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
