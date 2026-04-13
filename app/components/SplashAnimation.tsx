'use client';

interface SplashAnimationProps {
  active: boolean;
}

export function SplashAnimation({ active }: SplashAnimationProps) {
  if (!active) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center overflow-hidden"
    >
      <span className="splash-core splash-core--active" />
      {/* Ripple rings */}
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="splash-ring splash-ring--active"
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  );
}
