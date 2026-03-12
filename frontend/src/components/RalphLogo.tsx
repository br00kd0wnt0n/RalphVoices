interface RalphLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showVoices?: boolean;
}

export function RalphLogo({ size = 'md', showVoices = true }: RalphLogoProps) {
  const sizes = {
    sm: { height: 'h-6', voicesText: 'text-sm', letterSpacing: '0.12em' },
    md: { height: 'h-8', voicesText: 'text-lg', letterSpacing: '0.14em' },
    lg: { height: 'h-14', voicesText: 'text-2xl', letterSpacing: '0.16em' },
  };

  return (
    <div className="flex items-center gap-2.5">
      <img
        src="/logo.png"
        alt="Ralph"
        className={`${sizes[size].height} w-auto object-contain mix-blend-screen`}
      />
      {showVoices && (
        <span
          className={`${sizes[size].voicesText} font-semibold uppercase`}
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            letterSpacing: sizes[size].letterSpacing,
            background: 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(217,77,143,0.9) 50%, rgba(255,255,255,0.5) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          Voices
        </span>
      )}
    </div>
  );
}
