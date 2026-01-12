interface RalphLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showVoices?: boolean;
}

export function RalphLogo({ size = 'md', showVoices = true }: RalphLogoProps) {
  const sizes = {
    sm: { height: 'h-6', voicesText: 'text-sm' },
    md: { height: 'h-8', voicesText: 'text-lg' },
    lg: { height: 'h-14', voicesText: 'text-2xl' },
  };

  return (
    <div className="flex items-center gap-2">
      <img
        src="/logo.png"
        alt="Ralph"
        className={`${sizes[size].height} w-auto object-contain mix-blend-screen`}
      />
      {showVoices && (
        <span className={`${sizes[size].voicesText} text-foreground/60 font-light tracking-wide`}>
          voices
        </span>
      )}
    </div>
  );
}
