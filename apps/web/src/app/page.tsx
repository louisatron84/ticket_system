import type { Metadata } from 'next';
import { SystemStatus } from '@/components/status/system-status';
import { fetchReadiness } from '@/lib/api';

export const metadata: Metadata = { title: 'Overview' };
// The status must be measured on every request, never baked in at build time.
export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const result = await fetchReadiness(process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000');

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
      <SystemStatus result={result} checkedAt={new Date()} />
    </div>
  );
}
