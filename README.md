# Ralph Voices

A synthetic audience panel tool that creates AI personas calibrated to client briefs and tests creative concepts against persona variants.

## Core Value Proposition

Replace gut-check with pattern recognition. Instead of asking "will this land?" teams ask "what patterns emerge when we expose this to a statistically meaningful synthetic cohort?"

## Features

- **Persona Builder**: Create detailed AI personas with psychographics, media habits, brand context, and cultural markers
- **Variant Generator**: Generate 10-100 diverse variants from each base persona
- **Concept Testing**: Test creative concepts against your synthetic audience panel
- **Results Dashboard**: View aggregate metrics, segment breakdowns, and individual responses
- **Real-time Progress**: WebSocket-based progress tracking during test execution

## Tech Stack

- **Frontend**: React + TypeScript + Tailwind CSS + Vite
- **Backend**: Node.js + Express + TypeScript
- **Database**: PostgreSQL
- **AI**: OpenAI GPT-4o
- **Charts**: Recharts

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database
- OpenAI API key

### Installation

1. Clone the repository:
```bash
cd ralph-voices
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Run database migrations:
```bash
npm run db:migrate
```

5. (Optional) Seed demo data:
```bash
npm run db:seed
```

6. Start the development servers:
```bash
npm run dev
```

This starts:
- Backend API on http://localhost:3001
- Frontend on http://localhost:5173

### Demo Credentials

After running the seed script:
- Email: demo@ralph.com
- Password: demo123

## Project Structure

```
ralph-voices/
├── backend/
│   ├── src/
│   │   ├── db/           # Database schema and migrations
│   │   ├── middleware/   # Auth middleware
│   │   ├── routes/       # API routes
│   │   ├── services/     # AI service layer
│   │   ├── utils/        # Types and utilities
│   │   └── index.ts      # Express server
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/   # React components
│   │   ├── hooks/        # Custom hooks (auth)
│   │   ├── lib/          # API client and utilities
│   │   ├── pages/        # Page components
│   │   ├── types/        # TypeScript types
│   │   └── App.tsx       # Main app component
│   └── package.json
└── package.json
```

## API Endpoints

### Auth
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user

### Projects
- `GET /api/projects` - List projects
- `POST /api/projects` - Create project
- `GET /api/projects/:id` - Get project details
- `DELETE /api/projects/:id` - Delete project

### Personas
- `GET /api/personas` - List personas
- `POST /api/personas` - Create persona
- `GET /api/personas/:id` - Get persona with variants
- `PUT /api/personas/:id` - Update persona
- `DELETE /api/personas/:id` - Delete persona
- `POST /api/personas/:id/variants` - Generate variants
- `POST /api/personas/:id/voice` - Regenerate voice sample

### Tests
- `GET /api/tests` - List tests
- `POST /api/tests` - Create test
- `GET /api/tests/:id` - Get test with results
- `DELETE /api/tests/:id` - Delete test
- `POST /api/tests/:id/run` - Execute test
- `GET /api/tests/:id/responses` - Get paginated responses
- `GET /api/tests/:id/results` - Get aggregated results

### WebSocket
- `WS /ws/tests/:id/progress` - Real-time test progress

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/ralph_voices

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o

# App
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# Auth
JWT_SECRET=your-secret-key
```

## Usage Flow

1. **Create a Project** - Organize your work by client/campaign
2. **Build Personas** - Create detailed synthetic audience members
3. **Generate Variants** - Create 20-50 diverse variants per persona
4. **Run Test** - Enter a concept and let the AI generate responses
5. **Analyze Results** - View sentiment, engagement, themes, and individual feedback

## Cost Considerations

Each test with 50 variants generates approximately 50 GPT-4o API calls:
- ~$1-3 per test depending on concept length
- Voice sample generation: ~$0.02 per persona
- Variant generation: ~$0.10 per batch

## License

Proprietary - Ralph Agency
