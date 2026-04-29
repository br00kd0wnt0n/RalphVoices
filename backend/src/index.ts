import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import expressWs from 'express-ws';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { pool } from './db/index.js';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import personaRoutes from './routes/personas.js';
import testRoutes, { testProgress } from './routes/tests.js';
import uploadRoutes from './routes/uploads.js';
import gwiRoutes from './routes/gwi.js';
import anchorRoutes from './routes/anchors.js';

dotenv.config();

// ---------------------------------------------------------------------------
// Startup safety checks (audit findings #2, #3, #4)
// ---------------------------------------------------------------------------

// Refuse to boot with an insecure JWT secret. Allow override only when the dev
// is explicitly opting in via ALLOW_INSECURE_JWT in a development environment.
function assertJwtSecret(): void {
  const secret = process.env.JWT_SECRET;
  const insecureDefault = 'development-secret-change-me';
  const isDev = process.env.NODE_ENV === 'development';
  const overrideAllowed = isDev && process.env.ALLOW_INSECURE_JWT === 'true';

  if (!secret) {
    if (overrideAllowed) {
      console.warn('[startup] WARNING: JWT_SECRET is unset; ALLOW_INSECURE_JWT=true permits this in development only.');
      return;
    }
    console.error('[startup] FATAL: JWT_SECRET is not set. Refusing to boot.');
    process.exit(1);
  }

  if (secret === insecureDefault) {
    if (overrideAllowed) {
      console.warn('[startup] WARNING: JWT_SECRET is the development default; ALLOW_INSECURE_JWT=true permits this in development only.');
      return;
    }
    console.error('[startup] FATAL: JWT_SECRET is set to the insecure development default. Refusing to boot.');
    process.exit(1);
  }
}

assertJwtSecret();

// Demo mode + GWI status are opt-in env flags; surface them in logs so
// operators can see at a glance what the deployment is doing.
const DEMO_MODE_ENABLED = process.env.ENABLE_DEMO_MODE === 'true';
const GWI_ENABLED = process.env.ENABLE_GWI === 'true';

if (DEMO_MODE_ENABLED) {
  console.warn(
    '[startup] WARNING: ENABLE_DEMO_MODE=true — unauthenticated requests will be logged in as demo@ralphvoices.com. Do not run with this flag in any client-facing or shared deployment.'
  );
} else {
  console.log('[startup] Demo mode disabled. Unauthenticated requests will receive 401.');
}

console.log(`[startup] GWI integration: ${GWI_ENABLED ? 'enabled' : 'disabled (set ENABLE_GWI=true and supply GWI_API_KEY to activate)'}`);

// Auto-run migrations on startup
async function runMigrations() {
  try {
    const schemaPath = join(process.cwd(), 'src', 'db', 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    await pool.query(schema);

    const migrationsDir = join(process.cwd(), 'src', 'db', 'migrations');
    try {
      const files = readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      for (const file of files) {
        const sql = readFileSync(join(migrationsDir, file), 'utf-8');
        await pool.query(sql);
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }

    console.log('Database migrations applied.');
  } catch (error) {
    console.error('Migration warning (non-fatal):', error);
  }
}

// Boot orchestration — migrations must finish before the retention job and
// stale-test sweep run, otherwise the sweep races and errors out querying
// test_progress before migration 006 has created it.
async function bootSequence(): Promise<void> {
  await runMigrations();
  await runRetentionPolicy();
  await sweepStaleRunningTests();
  // Retention then runs daily on its own interval below.
}

// ---------------------------------------------------------------------------
// Retention job (Task 6)
// ---------------------------------------------------------------------------
// When TEST_RETENTION_DAYS is set, completed tests older than N days are
// archived (status='archived') and their heavy uploaded payloads
// (options.assets) are nulled out. Test metadata + scoring results are
// preserved so historical reporting still works; only the raw client
// uploads are stripped. Unset = no expiry (backwards-compatible default).
async function runRetentionPolicy(): Promise<void> {
  const retentionRaw = process.env.TEST_RETENTION_DAYS;
  if (!retentionRaw) return;

  const retentionDays = parseInt(retentionRaw, 10);
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    console.warn(`[retention] TEST_RETENTION_DAYS=${retentionRaw} is not a positive integer; skipping.`);
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE tests
         SET status = 'archived',
             options = COALESCE(options, '{}'::jsonb) - 'assets'
       WHERE status = 'complete'
         AND completed_at < NOW() - ($1 || ' days')::interval
       RETURNING id`,
      [retentionDays]
    );
    if (result.rowCount && result.rowCount > 0) {
      console.log(`[retention] Archived ${result.rowCount} test(s) older than ${retentionDays} days.`);
    }
  } catch (error) {
    console.error('[retention] Retention pass failed:', error);
  }
}

// Daily retention pass. The first pass at boot runs inside bootSequence() so
// migrations are guaranteed to have completed first.
setInterval(runRetentionPolicy, 24 * 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// Stale test sweep (Task 8)
// ---------------------------------------------------------------------------
// Any test that was running when the previous process died will sit forever in
// 'running' status with a stale last_updated. On boot, mark anything older than
// the cutoff as failed so the UI shows the correct state. Resume logic is
// out-of-scope for this run — the user can hit "Retry" from the UI.
const STALE_RUNNING_CUTOFF_MS = 5 * 60 * 1000;

async function sweepStaleRunningTests(): Promise<void> {
  try {
    const cutoffSeconds = Math.floor(STALE_RUNNING_CUTOFF_MS / 1000);
    const result = await pool.query(
      `UPDATE tests
         SET status = 'failed'
       WHERE id IN (
         SELECT t.id FROM tests t
         LEFT JOIN test_progress tp ON tp.test_id = t.id
         WHERE t.status = 'running'
           AND (
             tp.last_updated IS NULL
             OR tp.last_updated < NOW() - ($1 || ' seconds')::interval
           )
       )
       RETURNING id`,
      [cutoffSeconds]
    );
    if (result.rowCount && result.rowCount > 0) {
      console.warn(`[startup] Marked ${result.rowCount} stale running test(s) as failed (server restart cleanup).`);
      await pool.query(
        `UPDATE test_progress
           SET status = 'failed', last_updated = NOW()
         WHERE test_id = ANY($1::uuid[])`,
        [result.rows.map((r: any) => r.id)]
      );
    }
  } catch (error) {
    console.error('[startup] Stale-test sweep failed:', error);
  }
}

// First sweep happens inside bootSequence() above, after migrations.
bootSequence().catch((err) => console.error('[startup] Boot sequence failed:', err));

const app = express();
const wsInstance = expressWs(app);

// CORS configuration
const corsOptions = {
  origin: [
    'https://ralphvoices.up.railway.app',
    'https://frontend-production-a08a.up.railway.app',
    'http://localhost:5173',
    'http://localhost:3000',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// Middleware
app.use(cors(corsOptions));

// Handle preflight requests explicitly
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Root route
app.get('/', (req, res) => {
  res.json({
    name: 'Ralph Voices API',
    version: '1.0.0',
    endpoints: ['/api/auth', '/api/projects', '/api/personas', '/api/tests'],
    health: '/health'
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// OpenAI test endpoint
app.get('/api/test-openai', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o';

  if (!apiKey) {
    res.json({
      status: 'error',
      message: 'OPENAI_API_KEY not configured',
      api_key_set: false,
      model
    });
    return;
  }

  try {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey });

    const response = await openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Say "API working" in exactly 2 words.' }],
      max_tokens: 10,
    });

    const content = response.choices[0]?.message?.content || '';

    res.json({
      status: 'ok',
      api_key_set: true,
      api_key_prefix: apiKey.substring(0, 10) + '...',
      model,
      test_response: content,
      finish_reason: response.choices[0]?.finish_reason,
    });
  } catch (error: any) {
    res.json({
      status: 'error',
      api_key_set: true,
      model,
      error_name: error.name,
      error_message: error.message,
      error_status: error.status,
      error_code: error.code,
    });
  }
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/personas', personaRoutes);
app.use('/api/tests', testRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/gwi', gwiRoutes);
app.use('/api/anchors', anchorRoutes);

// WebSocket endpoint for test progress
wsInstance.app.ws('/ws/tests/:id/progress', (ws, req) => {
  const testId = req.params.id;
  console.log(`WebSocket connected for test ${testId}`);

  const intervalId = setInterval(() => {
    const progress = testProgress.get(testId);
    if (progress) {
      ws.send(JSON.stringify(progress));

      if (progress.status === 'complete' || progress.status === 'failed' || progress.status === 'cancelled') {
        clearInterval(intervalId);
        ws.close();
      }
    }
  }, 1000);

  ws.on('close', () => {
    console.log(`WebSocket disconnected for test ${testId}`);
    clearInterval(intervalId);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clearInterval(intervalId);
  });
});

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Ralph Voices API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;
