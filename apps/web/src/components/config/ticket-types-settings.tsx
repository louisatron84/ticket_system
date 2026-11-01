'use client';

import type { TicketTypeSetting } from '@forge/shared';
import { SettingList } from './setting-list';

/** The workspace's ticket types, in the order pickers show them. */
export function TicketTypesSettings({
  organisationId,
  types,
}: {
  organisationId: string;
  types: TicketTypeSetting[];
}) {
  return (
    <SettingList
      organisationId={organisationId}
      path="ticket-types"
      heading="Ticket types"
      noun="type"
      description="What kinds of work tickets are. A deactivated type is no longer offered; tickets that have it keep it."
      items={types}
    />
  );
}
