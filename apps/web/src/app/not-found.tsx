import type { Metadata } from 'next';
import { NotFoundView } from '@/components/not-found-view';

export const metadata: Metadata = { title: 'Page not found' };

// For addresses that match no route at all; rendered without the application shell.
export default function NotFound() {
  return <NotFoundView standalone />;
}
