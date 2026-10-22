/**
 * Shared button look. Accent colour is reserved for "where you are" and focus, so even the
 * primary button is neutral: light on dark.
 */
const BASE =
  'inline-flex h-8 items-center justify-center gap-2 rounded-md px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const VARIANTS = {
  secondary: 'border border-edge-strong bg-raised hover:border-muted',
  primary: 'bg-text text-bg hover:bg-white',
  danger: 'border border-fail/60 text-fail hover:bg-fail/10',
} as const;

export const buttonClass = (variant: keyof typeof VARIANTS = 'secondary') =>
  `${BASE} ${VARIANTS[variant]}`;
