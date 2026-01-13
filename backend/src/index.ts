import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import expressWs from 'express-ws';

import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import personaRoutes from './routes/personas.js';
import testRoutes, { testProgress } from './routes/tests.js';

dotenv.config();

const app = express();
const wsInstance = expressWs(app);

// Middleware
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());

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

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/personas', personaRoutes);
app.use('/api/tests', testRoutes);

// WebSocket endpoint for test progress
wsInstance.app.ws('/ws/tests/:id/progress', (ws, req) => {
  const testId = req.params.id;
  console.log(`WebSocket connected for test ${testId}`);

  const intervalId = setInterval(() => {
    const progress = testProgress.get(testId);
    if (progress) {
      ws.send(JSON.stringify(progress));

      if (progress.status === 'complete' || progress.status === 'failed') {
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
