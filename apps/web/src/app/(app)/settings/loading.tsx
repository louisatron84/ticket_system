import { PageSkeleton } from '@/components/page-skeleton';

// Sits below the layouts on purpose: a layout that calls notFound() or redirect() must run before
// anything streams, or the response would already be committed as 200.
export default function Loading() {
  return <PageSkeleton />;
}
