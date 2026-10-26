export function ForkMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <path d="M16 30 V18 C16 12 7 12 7 3" stroke="var(--color-path-a)" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M16 18 C16 12 25 12 25 3" stroke="var(--color-path-b)" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M16 30 V18" stroke="var(--color-paper)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
