import type { Metadata } from 'next';
import { NotFoundView } from '@/components/not-found-view';

export const metadata: Metadata = { title: 'Page not found' };

// For anything that calls notFound() inside the signed-in area, such as a workspace the person
// is not a member of. Rendered inside the shell, so it must not add a second <main>.
export default function AppNotFound() {
  return <NotFoundView />;
}
