import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  Brain,
  FileText,
  Target,
  MessageSquare,
  BarChart3,
  ArrowRight,
  ArrowDown,
  RotateCcw,
  ChevronDown,
  Database,
  Cpu,
  Layers,
  Globe,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

// ---------------------------------------------------------------------------
// Flow step data
// ---------------------------------------------------------------------------

interface FlowStep {
  id: string;
  icon: React.ElementType;
  title: string;
  subtitle: string;
  color: string;
  bgColor: string;
  borderColor: string;
  detail: string[];
}

const pipelineSteps: FlowStep[] = [
  {
    id: 'persona',
    icon: Users,
    title: 'Create Persona',
    subtitle: 'Define your audience',
    color: 'text-[#D94D8F]',
    bgColor: 'bg-pink-50',
    borderColor: 'border-[#D94D8F]/30',
    detail: [
      'Build detailed audience profiles with demographics, psychographics, media habits, and cultural context.',
      'Each persona captures values, motivations, pain points, decision style, platform usage, humor preferences, and language markers.',
      'Personas generate AI variants — unique individuals who share the base profile but differ in age, attitude, platform preference, and voice.',
    ],
  },
  {
    id: 'embed',
    icon: Brain,
    title: 'Vector Embedding',
    subtitle: '4-facet persona fingerprint',
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-300',
    detail: [
      'Each persona is embedded into four separate vector dimensions: values, platform habits, cultural context, and demographics.',
      'These embeddings capture the semantic meaning of each facet — not just keywords, but the underlying patterns that define how this person thinks and reacts.',
      'Stored as 1536-dimensional vectors in PostgreSQL via pgvector, enabling fast similarity search across thousands of personas.',
    ],
  },
  {
    id: 'concept',
    icon: FileText,
    title: 'Enter Concept',
    subtitle: 'What you want to test',
    color: 'text-[#D94D8F]',
    bgColor: 'bg-pink-50',
    borderColor: 'border-[#D94D8F]/30',
    detail: [
      'Submit creative concepts as text, images, or PDFs. Add strategic context — creative ambition, strategic truth, key insight.',
      'The concept is also embedded into the same vector space as your personas, enabling mathematical comparison.',
      'Choose a test focus (baseline, brand perception, purchase intent, creative impact, message clarity, or social shareability) to guide the analysis.',
    ],
  },
  {
    id: 'disposition',
    icon: Target,
    title: 'Disposition Scoring',
    subtitle: 'Deterministic score ranges',
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-300',
    detail: [
      'The system finds the K nearest reference anchors — historical persona-concept pairs with known scores — by combined vector similarity.',
      'Persona similarity (60% weight) and concept similarity (40% weight) produce a composite match score against each anchor.',
      'Weighted interpolation across matching anchors produces deterministic score ranges for sentiment, engagement, shareability, and comprehension.',
      'Same persona + same concept = same score ranges, every time. No AI opinion involved.',
    ],
  },
  {
    id: 'response',
    icon: MessageSquare,
    title: 'GPT Response',
    subtitle: 'Creative within constraints',
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-300',
    detail: [
      'GPT receives the persona profile, concept, and the computed score ranges as calibration instructions.',
      'It writes an in-character qualitative response that expresses the predetermined scores — GPT is the writer, not the strategist.',
      'Post-generation validation checks whether GPT stayed within the score bands, logging deviations for quality monitoring.',
    ],
  },
  {
    id: 'results',
    icon: BarChart3,
    title: 'View Results',
    subtitle: 'RalphScore™ & insights',
    color: 'text-[#D94D8F]',
    bgColor: 'bg-pink-50',
    borderColor: 'border-[#D94D8F]/30',
    detail: [
      'Results aggregate into the RalphScore™ (0-100): 30% sentiment + 30% engagement + 25% shareability + 15% comprehension, with a sentiment distribution modifier.',
      'Segment breakdowns by age, platform, and attitude. Emotional spectrum analysis. Key themes and associations extracted from response text.',
      'Optional GWI market enrichment overlays real consumer data — benchmarks, market context, audience recommendations.',
    ],
  },
];

// ---------------------------------------------------------------------------
// Expandable detail section
// ---------------------------------------------------------------------------

function DetailSection({ step, index }: { step: FlowStep; index: number }) {
  const [open, setOpen] = useState(false);
  const Icon = step.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 1.2 + index * 0.08 }}
    >
      <Card
        className={`cursor-pointer transition-all duration-200 hover:shadow-md ${step.borderColor} border`}
        onClick={() => setOpen(!open)}
      >
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${step.bgColor}`}>
                <Icon className={`h-4 w-4 ${step.color}`} />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold">{step.title}</CardTitle>
                <p className="text-xs text-muted-foreground">{step.subtitle}</p>
              </div>
            </div>
            <motion.div
              animate={{ rotate: open ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </motion.div>
          </div>
        </CardHeader>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <CardContent className="pt-0 pb-4 px-4">
              <ul className="space-y-2">
                {step.detail.map((line, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex gap-2">
                    <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${step.bgColor.replace('50', '400')}`} />
                    {line}
                  </li>
                ))}
              </ul>
            </CardContent>
          </motion.div>
        )}
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Flow step card (diagram node)
// ---------------------------------------------------------------------------

function FlowNode({ step, index }: { step: FlowStep; index: number }) {
  const Icon = step.icon;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, delay: 0.3 + index * 0.12 }}
      className={`flex flex-col items-center gap-2 p-4 rounded-xl border ${step.borderColor} ${step.bgColor} min-w-[140px]`}
    >
      <div className={`p-3 rounded-full bg-white shadow-sm`}>
        <Icon className={`h-6 w-6 ${step.color}`} />
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-foreground">{step.title}</p>
        <p className="text-xs text-muted-foreground leading-tight mt-0.5">{step.subtitle}</p>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Arrow connector
// ---------------------------------------------------------------------------

function Arrow({ index, direction = 'right' }: { index: number; direction?: 'right' | 'down' }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, delay: 0.5 + index * 0.12 }}
      className="flex items-center justify-center"
    >
      {direction === 'right' ? (
        <ArrowRight className="h-5 w-5 text-muted-foreground/50" />
      ) : (
        <ArrowDown className="h-5 w-5 text-muted-foreground/50" />
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function HowItWorks() {
  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center space-y-2"
      >
        <h1 className="text-3xl font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          How{' '}
          <span className="bg-gradient-to-r from-[#D94D8F] to-[#E87BB0] bg-clip-text text-transparent">
            VOICES
          </span>{' '}
          Works
        </h1>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          A deterministic scoring engine that uses vector similarity to ground AI responses in data, not opinion.
          Every test makes the system smarter.
        </p>
      </motion.div>

      {/* Flow Diagram — Top Row */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="rounded-2xl border border-border/50 bg-muted/20 p-6"
      >
        {/* Row 1: Persona → Embed → Concept */}
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <FlowNode step={pipelineSteps[0]} index={0} />
          <Arrow index={0} />
          <FlowNode step={pipelineSteps[1]} index={1} />
          <Arrow index={1} />
          <FlowNode step={pipelineSteps[2]} index={2} />
        </div>

        {/* Down arrow */}
        <div className="flex justify-center my-3">
          <Arrow index={2} direction="down" />
        </div>

        {/* Row 2: Results ← GPT ← Disposition */}
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <FlowNode step={pipelineSteps[5]} index={5} />
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.9 }}
            className="flex items-center justify-center"
          >
            <ArrowRight className="h-5 w-5 text-muted-foreground/50 rotate-180" />
          </motion.div>
          <FlowNode step={pipelineSteps[4]} index={4} />
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.8 }}
            className="flex items-center justify-center"
          >
            <ArrowRight className="h-5 w-5 text-muted-foreground/50 rotate-180" />
          </motion.div>
          <FlowNode step={pipelineSteps[3]} index={3} />
        </div>

        {/* Feedback loop indicator */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 1.0 }}
          className="flex items-center justify-center gap-2 mt-6 pt-4 border-t border-dashed border-border/50"
        >
          <RotateCcw className="h-4 w-4 text-indigo-500" />
          <p className="text-xs text-muted-foreground">
            Completed tests seed new{' '}
            <span className="font-medium text-indigo-600">reference anchors</span>
            {' '}→ tighter score ranges → more repeatable results
          </p>
        </motion.div>
      </motion.div>

      {/* Key principle */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 1.0 }}
        className="flex items-start gap-4 rounded-xl border border-indigo-200 bg-indigo-50/30 p-5"
      >
        <div className="p-2 rounded-lg bg-indigo-100 shrink-0">
          <Cpu className="h-5 w-5 text-indigo-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground mb-1">Deterministic by Design</p>
          <p className="text-sm text-muted-foreground">
            The vector scoring engine computes score ranges algorithmically — same persona + same concept always
            produces the same constraints. GPT handles the creative expression within those locked bounds.
            No AI opinion in the numbers, only in the words.
          </p>
        </div>
      </motion.div>

      {/* Architecture detail cards */}
      <div>
        <motion.h2
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.1 }}
          className="text-lg font-semibold mb-3"
        >
          Pipeline Details
        </motion.h2>
        <div className="grid gap-2">
          {pipelineSteps.map((step, i) => (
            <DetailSection key={step.id} step={step} index={i} />
          ))}
        </div>
      </div>

      {/* Technical architecture section */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 1.5 }}
      >
        <h2 className="text-lg font-semibold mb-3">Under the Hood</h2>
        <div className="grid md:grid-cols-3 gap-3">
          <Card className="border-border/50">
            <CardContent className="pt-4 pb-4 px-4">
              <div className="flex items-center gap-2 mb-2">
                <Database className="h-4 w-4 text-indigo-600" />
                <p className="text-sm font-semibold">pgvector</p>
              </div>
              <p className="text-xs text-muted-foreground">
                PostgreSQL extension for vector similarity search.
                Persona and concept embeddings stored as 1536-dimensional vectors with IVFFlat indexes
                for sub-millisecond nearest-neighbor queries.
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="pt-4 pb-4 px-4">
              <div className="flex items-center gap-2 mb-2">
                <Layers className="h-4 w-4 text-[#D94D8F]" />
                <p className="text-sm font-semibold">Reference Anchors</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Every completed test response becomes a calibration point.
                Frozen embedding pairs with known scores. More tests = more anchors = tighter
                score ranges = higher confidence.
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="pt-4 pb-4 px-4">
              <div className="flex items-center gap-2 mb-2">
                <Globe className="h-4 w-4 text-emerald-600" />
                <p className="text-sm font-semibold">GWI Market Data</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Optional integration with GWI Spark for real-world market validation.
                Persona validation, post-test enrichment, benchmarks, and audience
                recommendations grounded in consumer survey data.
              </p>
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {/* RalphScore formula */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 1.6 }}
        className="rounded-xl border border-[#D94D8F]/20 bg-pink-50/30 p-5"
      >
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="h-5 w-5 text-[#D94D8F]" />
          <p className="text-sm font-semibold">RalphScore™ Formula</p>
        </div>
        <div className="font-mono text-sm text-muted-foreground space-y-1">
          <p>
            <span className="text-foreground font-medium">Base</span> = (sentiment × 0.30) + (engagement × 0.30) + (shareability × 0.25) + (comprehension × 0.15)
          </p>
          <p>
            <span className="text-foreground font-medium">Modifier</span> = 1 + (positive_ratio × 0.1) − (negative_ratio × 0.15)
          </p>
          <p>
            <span className="text-[#D94D8F] font-semibold">RalphScore</span> = round(base × 10 × modifier), clamped 0–100
          </p>
        </div>
      </motion.div>
    </div>
  );
}
