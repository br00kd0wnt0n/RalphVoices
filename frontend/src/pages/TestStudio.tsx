import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { tests as testsApi, projects as projectsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, TestTube, ArrowRight, Trash2 } from 'lucide-react';
import type { Test, Project } from '@/types';

export function TestStudio() {
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get('project') || '';

  const [tests, setTests] = useState<Test[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [projectFilter]);

  async function loadData() {
    setLoading(true);
    try {
      const [testsData, projectsData] = await Promise.all([
        testsApi.list(projectFilter || undefined),
        projectsApi.list(),
      ]);
      setTests(testsData);
      setProjects(projectsData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteTest(id: string) {
    if (!confirm('Are you sure you want to delete this test?')) return;
    try {
      await testsApi.delete(id);
      loadData();
    } catch (error) {
      console.error('Failed to delete test:', error);
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
          <h1 className="text-3xl font-bold">Test Studio</h1>
          <p className="text-muted-foreground mt-1">
            Run concept tests against your synthetic audience panel
          </p>
        </div>
        <Link to="/tests/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Test
          </Button>
        </Link>
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

      {/* Tests List */}
      {tests.length === 0 ? (
        <div className="text-center py-12 border rounded-lg">
          <TestTube className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No tests yet</h3>
          <p className="text-muted-foreground mb-4">
            Create a test to get feedback from your synthetic audience
          </p>
          <Link to="/tests/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Test
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {tests.map((test) => (
            <Card key={test.id} className="hover:border-primary/50 transition-colors">
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold">{test.name}</h3>
                      <Badge
                        variant={
                          test.status === 'complete'
                            ? 'success'
                            : test.status === 'running'
                            ? 'warning'
                            : test.status === 'failed'
                            ? 'destructive'
                            : 'secondary'
                        }
                      >
                        {test.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                      {test.concept_text?.slice(0, 100)}
                      {test.concept_text && test.concept_text.length > 100 && '...'}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span>
                        {new Date(test.created_at).toLocaleDateString()}
                      </span>
                      {test.status === 'running' && (
                        <span>
                          Progress: {test.responses_completed} / {test.responses_total}
                        </span>
                      )}
                      {test.status === 'complete' && test.responses_total > 0 && (
                        <span>{test.responses_total} responses</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteTest(test.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Link to={`/tests/${test.id}`}>
                      <Button variant="outline" size="sm">
                        View Results
                        <ArrowRight className="h-4 w-4 ml-1" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
