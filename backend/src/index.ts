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

runMigrations();

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
