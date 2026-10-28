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
  /** For quiet actions inside a row or toolbar. */
  ghost: 'text-muted hover:bg-raised hover:text-text',
} as const;

export const buttonClass = (variant: keyof typeof VARIANTS = 'secondary') =>
  `${BASE} ${VARIANTS[variant]}`;

const CONTROL =
  'w-full rounded-md border bg-raised px-2.5 text-[13px] text-text placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60';

/** Text inputs and selects. An invalid control swaps its border to the failure colour. */
export const inputClass = (invalid = false) =>
  `${CONTROL} h-8 ${invalid ? 'border-fail' : 'border-edge-strong'}`;

export const textareaClass = (invalid = false) =>
  `${CONTROL} min-h-24 resize-y py-1.5 ${invalid ? 'border-fail' : 'border-edge-strong'}`;
