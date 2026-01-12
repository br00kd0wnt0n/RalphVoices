import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { personas as personasApi, projects as projectsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PersonaCard } from '@/components/PersonaCard';
import { PersonaBuilder } from '@/components/PersonaBuilder';
import { Plus, Users } from 'lucide-react';
import type { Persona, Project } from '@/types';

export function Personas() {
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get('project') || '';

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [builderOpen, setBuilderOpen] = useState(false);

  useEffect(() => {
    loadData();
  }, [projectFilter]);

  async function loadData() {
    setLoading(true);
    try {
      const [personasData, projectsData] = await Promise.all([
        personasApi.list(projectFilter || undefined),
        projectsApi.list(),
      ]);
      setPersonas(personasData);
      setProjects(projectsData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }

  function handleProjectFilterChange(value: string) {
    if (value === 'all') {
      searchParams.delete('project');
    } else {
      searchParams.set('project', value);
    }
    setSearchParams(searchParams);
  }

  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Persona Lab</h1>
          <p className="text-muted-foreground mt-1">
            Create and manage your synthetic audience personas
          </p>
        </div>
        <Button onClick={() => setBuilderOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Persona
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Project:</span>
          <Select
            value={projectFilter || 'all'}
            onValueChange={handleProjectFilterChange}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Personas Grid */}
      {personas.length === 0 ? (
        <div className="text-center py-12 border rounded-lg">
          <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No personas yet</h3>
          <p className="text-muted-foreground mb-4">
            {projects.length === 0
              ? 'Create a project first, then add personas'
              : 'Create your first persona to start testing concepts'}
          </p>
          <Button onClick={() => setBuilderOpen(true)} disabled={projects.length === 0}>
            <Plus className="h-4 w-4 mr-2" />
            Create Persona
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {personas.map((persona) => (
            <PersonaCard
              key={persona.id}
              persona={persona}
              onDelete={loadData}
              onUpdate={loadData}
            />
          ))}
        </div>
      )}

      <PersonaBuilder
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        onCreated={loadData}
        defaultProjectId={projectFilter}
      />
    </div>
  );
}
