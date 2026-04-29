import { Info } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/**
 * RalphScoreInfo — click-to-open explainer for the RalphScore.
 *
 * Rendered as a small ⓘ button. Opens a modal with a plain-language
 * explanation of how the score is put together so users understand
 * (and trust) the number.
 */
export function RalphScoreInfo() {
  return (
    <Dialog>
      <DialogTrigger
        aria-label="How is the RalphScore calculated?"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition hover:bg-[#D94D8F]/10 hover:text-[#D94D8F] focus:outline-none focus:ring-2 focus:ring-[#D94D8F]/40"
      >
        <Info className="h-3.5 w-3.5" />
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">How the RalphScore works</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 text-sm leading-relaxed">
          <p className="text-muted-foreground">
            RalphScore is a single number (0–100) that tells you, at a glance,
            how your audience reacted to a concept. Here's what's behind it.
          </p>

          <section className="space-y-2">
            <h3 className="font-semibold text-foreground">1. What each AI persona gives us</h3>
            <p className="text-muted-foreground">
              For every reaction, the AI scores four things from 1 to 10:
            </p>
            <ul className="space-y-1 text-muted-foreground">
              <li><span className="font-medium text-foreground">Sentiment</span> — did they like it?</li>
              <li><span className="font-medium text-foreground">Engagement</span> — would they stop scrolling?</li>
              <li><span className="font-medium text-foreground">Share</span> — would they show a friend?</li>
              <li><span className="font-medium text-foreground">Comprehension</span> — did they get it?</li>
            </ul>
            <p className="text-muted-foreground">
              Plus mood tags — "excited," "confused," "feels authentic," "seen
              before" — little sticky notes describing the reaction.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold text-foreground">2. Keeping scores honest</h3>
            <p className="text-muted-foreground">
              Before asking each persona, we check how similar people reacted to
              similar ideas in the past and gently nudge the AI toward that
              range. It stops the model from giving everything a 10.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold text-foreground">3. Rolling it all up</h3>
            <p className="text-muted-foreground">Once everyone's responded, we tally:</p>
            <ul className="space-y-1 text-muted-foreground">
              <li>Averages for engagement, share, and comprehension.</li>
              <li>
                Sentiment sorted into three buckets: <span className="text-emerald-600 font-medium">liked it</span> (7+),{' '}
                <span className="text-yellow-600 font-medium">shrugged</span> (4–6),{' '}
                <span className="text-red-500 font-medium">didn't like it</span> (below 4).
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold text-foreground">4. The RalphScore recipe</h3>
            <p className="text-muted-foreground">Four ingredients, weighted:</p>
            <ul className="space-y-1 text-muted-foreground">
              <li>🎭 <span className="font-medium text-foreground">Sentiment</span> — 30%</li>
              <li>👀 <span className="font-medium text-foreground">Engagement</span> — 30%</li>
              <li>📣 <span className="font-medium text-foreground">Shareability</span> — 25%</li>
              <li>🧠 <span className="font-medium text-foreground">Comprehension</span> — 15%</li>
            </ul>
            <p className="text-muted-foreground">
              Then a small tweak for the crowd: a mostly-positive room gets a
              small boost, and a room with real haters gets a bigger penalty.
              <span className="italic"> One loud hater hurts you more than one loud fan helps you</span> — just like real life.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold text-foreground">5. Reading the score</h3>
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border/60">
                  <tr><td className="py-2 px-3 font-semibold text-green-500">80+</td><td className="py-2 px-3">Excellent — ship it</td></tr>
                  <tr><td className="py-2 px-3 font-semibold text-emerald-500">65–79</td><td className="py-2 px-3">Strong — tighten, then ship</td></tr>
                  <tr><td className="py-2 px-3 font-semibold text-yellow-500">50–64</td><td className="py-2 px-3">Promising — real potential</td></tr>
                  <tr><td className="py-2 px-3 font-semibold text-orange-500">35–49</td><td className="py-2 px-3">Needs work — back to the drawing board</td></tr>
                  <tr><td className="py-2 px-3 font-semibold text-red-500">&lt; 35</td><td className="py-2 px-3">Reconsider — rethink the concept</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg bg-[#D94D8F]/5 border border-[#D94D8F]/20 p-4 space-y-2">
            <h3 className="font-semibold text-foreground">The two things to remember</h3>
            <ol className="space-y-1 text-muted-foreground list-decimal list-inside">
              <li>Liking it and engaging with it matter most. Being understood matters least — we assume clarity is the minimum bar.</li>
              <li>Haters hurt more than fans help. Concepts that feel <span className="italic">good</span> to most people beat concepts that polarise.</li>
            </ol>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
