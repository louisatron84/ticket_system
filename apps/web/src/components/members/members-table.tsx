'use client';

import type { Member, Membership, RoleDetail } from '@forge/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { assignableRoles } from '@/lib/members';
import { buttonClass } from '@/lib/ui';

type Props = {
  organisationId: string;
  viewerUserId: string;
  /** The viewer's standing in this workspace. */
  actor: Membership;
  members: Member[];
  roles: RoleDetail[];
};

export function MembersTable({ organisationId, viewerUserId, actor, members, roles }: Props) {
  const ownerCount = members.filter((member) => member.role.key === 'owner').length;

  return (
    <div className="overflow-x-auto rounded-md border border-edge bg-panel">
      <table className="w-full text-left text-[13px]">
        <caption className="sr-only">Members of this workspace and their roles</caption>
        <thead>
          <tr className="border-b border-edge text-xs text-muted">
            <th scope="col" className="px-4 py-2 font-medium">
              Member
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Role
            </th>
            <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">
              Joined
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge">
          {members.map((member) => (
            // Keyed by role too, so a saved change remounts the row with fresh state.
            <MemberRow
              key={`${member.user.id}:${member.role.id}`}
              organisationId={organisationId}
              member={member}
              isSelf={member.user.id === viewerUserId}
              options={assignableRoles({
                actor: {
                  userId: viewerUserId,
                  roleKey: actor.role.key,
                  permissions: actor.permissions,
                },
                target: { userId: member.user.id, roleKey: member.role.key },
                roles,
                ownerCount,
              })}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemberRow({
  organisationId,
  member,
  isSelf,
  options,
}: {
  organisationId: string;
  member: Member;
  isSelf: boolean;
  options: RoleDetail[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(member.role.id);
  const [saving, setSaving] = useState(false);

  // Only offer editing when at least one *different* role is allowed.
  const editable = options.some((role) => role.id !== member.role.id);
  const selectId = `role-${member.user.id}`;

  async function save() {
    setSaving(true);
    try {
      await apiFetch(`/api/v1/orgs/${organisationId}/members/${member.user.id}`, {
        method: 'PATCH',
        json: { roleId: selected },
      });
      const roleName = options.find((role) => role.id === selected)?.name ?? 'the new role';
      toast.success(`Changed ${member.user.displayName}'s role to ${roleName}.`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not change the role.');
      setSelected(member.role.id);
      setSaving(false);
    }
  }

  return (
    <tr>
      <th scope="row" className="px-4 py-2.5 font-normal">
        <span className="block font-medium">
          {member.user.displayName}
          {isSelf && <span className="ml-2 text-xs font-normal text-muted">You</span>}
        </span>
        <span className="block text-xs text-muted">{member.user.email}</span>
      </th>
      <td className="px-4 py-2.5">
        {editable ? (
          <div className="flex items-center gap-2">
            <label htmlFor={selectId} className="sr-only">
              Role for {member.user.displayName}
            </label>
            <select
              id={selectId}
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              disabled={saving}
              className="h-8 rounded-md border border-edge-strong bg-raised px-2 text-[13px]"
            >
              {options.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={save}
              disabled={saving || selected === member.role.id}
              className={buttonClass('secondary')}
            >
              {saving ? 'Saving' : 'Save'}
            </button>
          </div>
        ) : (
          <span>{member.role.name}</span>
        )}
      </td>
      <td className="hidden px-4 py-2.5 text-muted sm:table-cell">
        <time dateTime={member.joinedAt}>{member.joinedAt.slice(0, 10)}</time>
      </td>
    </tr>
  );
}
