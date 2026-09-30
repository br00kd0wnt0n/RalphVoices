// How it works: the landing page, in the four steps.
import { Chip, CodeChip, PINK, PinkButton, HEADING_FONT } from './ui';

const STEPS: Array<{ title: string; what: string; you: string }> = [
  { title: 'Write', what: 'Pick the territory. Your lines come first, checked in seconds; then Studio writes the counts you set per field, around them.', you: 'Write a few lines, set how many of each field, generate.' },
  { title: 'Review', what: 'Every line with its flags and the skeptic’s objection. What you keep collects in the Kept tray, by field.', you: 'Keep, cut, edit, or ask for more like this.' },
  { title: 'Build & sign off', what: 'Kept lines become ads: one code per version, with the visual’s on-image text. Red flags fixed or overridden, expectations locked.', you: 'Build the versions and sign them off.' },
  { title: 'Assets', what: 'Each code’s finished asset: checked against the signed-off copy and the rules, then Trupanion’s decision.', you: 'Upload, pass Pre-flight; Vivan records Trupanion’s call.' },
];

export function Home({ onStart }: { onStart: () => void }) {
  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <section className="space-y-3">
        <h1 className="text-4xl font-bold leading-tight tracking-tight" style={HEADING_FONT}>
          Write your lines. Studio adds alternatives from angles you haven’t tried, and checks every one.
        </h1>
        <p className="text-lg text-[#A3A8B1]">You bring the taste. Studio brings range, the rules, and the audience’s pushback. The market decides what wins.</p>
        <PinkButton className="mt-1" onClick={onStart}>Start: Write →</PinkButton>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold" style={HEADING_FONT}>Four steps</h2>
        <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((st, i) => (
            <li key={st.title}>
              <div className="flex h-full w-full flex-col rounded-xl border border-[#272B34] bg-[#16181D] p-4">
                <div className="mb-2 flex items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: PINK }}>{i + 1}</span>
                  <span className="text-base font-semibold">{st.title}</span>
                </div>
                <p className="mb-3 text-sm leading-snug text-[#A3A8B1]">{st.what}</p>
                <p className="mt-auto border-t border-[#272B34] pt-2.5 text-sm leading-snug text-[#C9CCD2]"><span style={{ color: PINK }}>You:</span> {st.you}</p>
              </div>
            </li>
          ))}
        </ol>
        {/* Live: the explainer page for live results goes here (another session). */}
        <p className="mt-3 text-sm text-[#646A75]">Then <span className="text-[#858B96]">Live</span> (soon): live results next to each code, from the first weeks in market.</p>
      </section>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-[#272B34] bg-[#16181D] p-4">
          <h3 className="mb-2.5 text-base font-semibold">One status per code</h3>
          <div className="flex flex-wrap items-center gap-1.5 text-sm text-[#646A75]">
            <CodeChip state="draft" /> → <CodeChip state="signed" /> → <CodeChip state="passed" /> → <CodeChip state="cleared" /> → <CodeChip state="ready" />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5"><CodeChip state="changes" /><CodeChip state="edited" /></div>
          <p className="mt-2 text-sm text-[#858B96]">From the whole version: all its fields and the visual’s on-image text.</p>
        </div>
        <div className="rounded-xl border border-[#272B34] bg-[#16181D] p-4">
          <h3 className="mb-2.5 text-base font-semibold">Reading the flags</h3>
          <ul className="space-y-2 text-sm leading-snug text-[#C9CCD2]">
            <li className="flex items-center gap-2"><Chip tone="red">red</Chip> Breaks a client rule: fix it, or override with a reason.</li>
            <li className="flex items-center gap-2"><Chip tone="amber">amber</Chip> Worth a look.</li>
            <li className="flex items-center gap-2"><Chip tone="grey">grey</Chip> A note.</li>
          </ul>
          <p className="mt-2 text-sm text-[#858B96]">Flags, not scores. Studio doesn’t predict what wins.</p>
        </div>
        <div className="flex flex-col rounded-xl border border-dashed border-[#4B55A8] bg-[#151A3A] p-4">
          <span className="text-xs uppercase tracking-wider text-[#8F97D6]">Top right</span>
          <span className="mt-1 text-base font-semibold text-white">Territories, Rules, Compare, Export</span>
          <span className="mt-1 text-sm leading-snug text-[#B9BFEA]">Edit the territories, read the live rules, run a blind compare of writing models, and every download in one menu.</span>
        </div>
      </section>
    </div>
  );
}
