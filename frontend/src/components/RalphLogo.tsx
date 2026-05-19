// Shared Voices wordmark + Ralph World planet logo.
//
// Brought into alignment with the Narrativ shell + Brainstorm +
// Brand Signals + RCB treatment (Brook 2026-05-19): ralph-world.png
// planet with a pink drop-shadow glow, mixed-case wordmark in Space
// Grotesk light with a pink terminal period. The previous uppercase-
// gradient "VOICES" diverged from the rest of the Ralph tool suite —
// this version reads as one consistent brand at every scale.
//
// Same canonical sizing as the Narrativ-side RalphLogo so the visual
// hierarchy matches across tools. If a new size is needed, add it
// here rather than overriding inline.

interface RalphLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showVoices?: boolean;
}

const sizes = {
  xs: { planet: 'h-4 w-4',   text: 'text-[13px]', glow: 'drop-shadow-[0_0_6px_rgba(217,77,143,0.35)]' },
  sm: { planet: 'h-6 w-6',   text: 'text-[15px]', glow: 'drop-shadow-[0_0_8px_rgba(217,77,143,0.4)]' },
  md: { planet: 'h-8 w-8',   text: 'text-[20px]', glow: 'drop-shadow-[0_0_12px_rgba(217,77,143,0.4)]' },
  lg: { planet: 'h-16 w-16', text: 'text-[44px]', glow: 'drop-shadow-[0_0_24px_rgba(217,77,143,0.45)]' },
};

export function RalphLogo({ size = 'md', showVoices = true }: RalphLogoProps) {
  const s = sizes[size];

  return (
    <div className="flex items-center gap-3">
      <img
        src="/ralph-world.png"
        alt="Ralph"
        className={`${s.planet} object-contain ${s.glow}`}
      />
      {showVoices && (
        <span
          className={`${s.text} leading-none font-light text-white`}
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            letterSpacing: '-0.02em',
          }}
        >
          Voices<span style={{ color: '#D94D8F' }}>.</span>
        </span>
      )}
    </div>
  );
}
