import { Router, Response } from 'express';
import { query } from '../db/index.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';

const router = Router();

const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  client_name: z.string().max(255).optional(),
});

// Create project
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const data = createProjectSchema.parse(req.body);

    const result = await query(
      `INSERT INTO projects (name, client_name, created_by)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [data.name, data.client_name || null, req.user!.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    console.error('Create project error:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// List projects
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT p.*,
        (SELECT COUNT(*) FROM personas WHERE project_id = p.id) as persona_count,
        (SELECT COUNT(*) FROM tests WHERE project_id = p.id) as test_count
       FROM projects p
       WHERE p.created_by = $1
       ORDER BY p.created_at DESC`,
      [req.user!.id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('List projects error:', error);
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

// Get project with personas and tests
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const projectResult = await query(
      `SELECT * FROM projects WHERE id = $1 AND created_by = $2`,
      [req.params.id, req.user!.id]
    );

    if (projectResult.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const project = projectResult.rows[0];

    const [personasResult, testsResult] = await Promise.all([
      query(
        `SELECT id, name, age_base, location, occupation, created_at
         FROM personas WHERE project_id = $1 ORDER BY created_at DESC`,
        [project.id]
      ),
      query(
        `SELECT id, name, test_type, status, created_at, completed_at
         FROM tests WHERE project_id = $1 ORDER BY created_at DESC`,
        [project.id]
      ),
    ]);

    res.json({
      ...project,
      personas: personasResult.rows,
      tests: testsResult.rows,
    });
  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({ error: 'Failed to get project' });
  }
});

// Update project
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const data = createProjectSchema.parse(req.body);

    const result = await query(
      `UPDATE projects
       SET name = $1, client_name = $2
       WHERE id = $3 AND created_by = $4
       RETURNING *`,
      [data.name, data.client_name || null, req.params.id, req.user!.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    console.error('Update project error:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// Delete project
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `DELETE FROM projects WHERE id = $1 AND created_by = $2 RETURNING id`,
      [req.params.id, req.user!.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

export default router;
