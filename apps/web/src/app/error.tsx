'use client';

import { ErrorView } from '@/components/error-view';

// Catches failures the signed-in area cannot (for example the API being down while the shell loads).
export default function RootError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorView {...props} standalone />;
}
