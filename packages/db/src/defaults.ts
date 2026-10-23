import {
  DEFAULT_PRIORITIES,
  DEFAULT_STATUS_TEMPLATE,
  DEFAULT_TICKET_TYPES,
  SYSTEM_ROLES,
  type SystemRoleKey,
} from '@forge/shared';
import { eq } from 'drizzle-orm';
import type { Db } from './client';
import type { Executor } from './organisations';
import {
  organisations,
  priorities,
  projectStatuses,
  projects,
  roles,
  statusTransitions,
  ticketTypes,
} from './schema';

/**
 * Makes sure a workspace has the standard ticket types and priorities. Only fills gaps: anything
 * already there (renamed, deactivated, re-ranked) is left exactly as it is.
 */
export async function ensureOrganisationDefaults(
  executor: Executor,
  organisationId: string,
): Promise<void> {
  await executor
    .insert(ticketTypes)
    .values(
      DEFAULT_TICKET_TYPES.map((type) => ({
        organisationId,
        key: type.key,
        name: type.name,
        sortOrder: type.sortOrder,
      })),
    )
    .onConflictDoNothing({ target: [ticketTypes.organisationId, ticketTypes.key] });

  await executor
    .insert(priorities)
    .values(
      DEFAULT_PRIORITIES.map((priority) => ({
        organisationId,
        key: priority.key,
        name: priority.name,
        rank: priority.rank,
      })),
    )
    .onConflictDoNothing({ target: [priorities.organisationId, priorities.key] });
}

/** `ensureOrganisationDefaults` for every workspace. Run after migrations. */
export async function syncOrganisationDefaults(db: Db): Promise<void> {
  for (const { id } of await db.select({ id: organisations.id }).from(organisations)) {
    await ensureOrganisationDefaults(db, id);
  }
}

/**
 * Creates a project with its own copy of the default statuses and allowed transitions. The copy
 * is what lets each project's workflow diverge later.
 */
export async function createProject(
  executor: Executor,
  input: {
    organisationId: string;
    key: string;
    name: string;
    description?: string;
    createdBy: string;
  },
): Promise<{ projectId: string; statusIds: Record<string, string> }> {
  const { organisationId } = input;
  const [project] = await executor
    .insert(projects)
    .values({
      organisationId,
      key: input.key,
      name: input.name,
      description: input.description ?? '',
      createdBy: input.createdBy,
    })
    .returning({ id: projects.id });
  if (!project) throw new Error('Project insert returned no row');

  const statuses = await executor
    .insert(projectStatuses)
    .values(
      DEFAULT_STATUS_TEMPLATE.statuses.map((status, index) => ({
        organisationId,
        projectId: project.id,
        key: status.key,
        name: status.name,
        category: status.category,
        sortOrder: index + 1,
        isInitial: status.initial === true,
      })),
    )
    .returning({ id: projectStatuses.id, key: projectStatuses.key });
  const statusIds = Object.fromEntries(statuses.map((status) => [status.key, status.id]));

  await executor.insert(statusTransitions).values(
    DEFAULT_STATUS_TEMPLATE.transitions.map(([from, to]) => ({
      organisationId,
      projectId: project.id,
      fromStatusId: statusIds[from]!,
      toStatusId: statusIds[to]!,
    })),
  );

  return { projectId: project.id, statusIds };
}

/**
 * System roles keep a copy of their permission list, so a permission added to the code reaches
 * existing workspaces only through this. Custom roles are never touched. Returns how many roles
 * it changed.
 */
export async function syncSystemRoles(db: Db): Promise<number> {
  let changed = 0;
  for (const role of await db.select().from(roles).where(eq(roles.isSystem, true))) {
    const definition = SYSTEM_ROLES[role.key as SystemRoleKey];
    if (!definition) continue;

    const wanted = [...definition.permissions].sort();
    const current = [...role.permissions].sort();
    if (wanted.length === current.length && wanted.every((value, i) => value === current[i])) {
      continue;
    }
    await db
      .update(roles)
      .set({ permissions: [...definition.permissions] })
      .where(eq(roles.id, role.id));
    changed += 1;
  }
  return changed;
}
