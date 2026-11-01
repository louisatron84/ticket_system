'use client';

import type { PrioritySetting } from '@forge/shared';
import { SettingList } from './setting-list';

/**
 * The workspace's priorities, most urgent first. The API keeps them least urgent first (rank
 * rises with urgency), so the order shown is reversed both ways.
 */
export function PrioritiesSettings({
  organisationId,
  priorities,
}: {
  organisationId: string;
  priorities: PrioritySetting[];
}) {
  const shown = [...priorities].sort((a, b) => b.rank - a.rank);
  return (
    <SettingList
      organisationId={organisationId}
      path="priorities"
      heading="Priorities"
      noun="priority"
      description="Most urgent at the top: the order is what higher means. A deactivated priority is no longer offered; tickets that have it keep it."
      items={shown}
      saveOrder={(ids) => [...ids].reverse()}
    />
  );
}
