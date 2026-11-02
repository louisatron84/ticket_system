import { z } from 'zod';
import { singleLineText } from './text';
import { ESTIMATION_SYSTEMS, calendarDate, multiLineText, ticketSummarySchema } from './tickets';

// P6 planning: the ranked backlog.

/**
 * Where to put a ticket in its project's backlog: at the top or bottom (`to`), or next to other
 * tickets: just below `after`, just above `before`, or between the two.
 */
export const rankTicketBodySchema = z
  .strictObject({
    to: z.enum(['top', 'bottom']).optional(),
    /** The ticket that should come just above it. */
    after: z.string().min(1).max(40).optional(),
    /** The ticket that should come just below it. */
    before: z.string().min(1).max(40).optional(),
  })
  .refine(
    (body) => (body.to !== undefined) !== (body.after !== undefined || body.before !== undefined),
    'Say where it goes: to the top or bottom, or after or before another ticket.',
  )
  .refine(
    (body) => body.after === undefined || body.after !== body.before,
    'A ticket cannot sit between one ticket and itself.',
  );
export type RankTicketBody = z.infer<typeof rankTicketBodySchema>;

export const backlogItemSchema = ticketSummarySchema.extend({
  rank: z.string(),
  /** The cycle it is planned into, if any. */
  cycleId: z.uuid().nullable(),
  estimateMinutes: z.number().int().nullable(),
  estimatePoints: z.number().int().nullable(),
});
export type BacklogItem = z.infer<typeof backlogItemSchema>;

/** At most this many backlog tickets are sent at once. */
export const BACKLOG_LIMIT = 500;

/** A project's open tickets, top of the backlog first. */
export const backlogSchema = z.object({
  estimation: z.enum(ESTIMATION_SYSTEMS),
  /** With cycles on: the planned and active cycles a ticket can be put into. */
  cycles: z.array(
    z.object({ id: z.uuid(), name: z.string(), state: z.enum(['planned', 'active']) }),
  ),
  /** An archived project's backlog can be read but not reordered. */
  archived: z.boolean(),
  items: z.array(backlogItemSchema),
  /** How many open tickets there are in all; more than `items` when the list was cut short. */
  total: z.number().int().nonnegative(),
});
export type Backlog = z.infer<typeof backlogSchema>;

// Milestones: dated goals of one project that group tickets.

export const MILESTONE_HEALTH = ['on_track', 'at_risk', 'off_track'] as const;
export type MilestoneHealth = (typeof MILESTONE_HEALTH)[number];

export const MILESTONE_HEALTH_LABELS: Record<MilestoneHealth, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
};

/** At most this many milestones per project, open and closed. */
export const MAX_MILESTONES = 200;

export const milestoneRefSchema = z.object({ id: z.uuid(), name: z.string() });
export type MilestoneRef = z.infer<typeof milestoneRefSchema>;

const counts = z.object({
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const milestoneSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  targetDate: z.string().nullable(),
  health: z.enum(MILESTONE_HEALTH),
  closed: z.boolean(),
  /** Its tickets (not archived): how many are completed, of how many. */
  tickets: counts,
  /** The same, by estimate in the project's system (tickets without one count as nothing). */
  estimate: counts,
});
export type Milestone = z.infer<typeof milestoneSchema>;

export const milestoneListSchema = z.object({
  estimation: z.enum(ESTIMATION_SYSTEMS),
  archived: z.boolean(),
  /** Open first, soonest target date first (none last), then by name. */
  milestones: z.array(milestoneSchema),
});
export type MilestoneList = z.infer<typeof milestoneListSchema>;

export const createMilestoneBodySchema = z.strictObject({
  name: singleLineText(80),
  description: multiLineText(2000).optional(),
  targetDate: calendarDate.nullable().optional(),
  health: z.enum(MILESTONE_HEALTH).optional(),
});
export type CreateMilestoneBody = z.infer<typeof createMilestoneBodySchema>;

export const updateMilestoneBodySchema = z
  .strictObject({
    name: singleLineText(80).optional(),
    description: multiLineText(2000).optional(),
    targetDate: calendarDate.nullable().optional(),
    health: z.enum(MILESTONE_HEALTH).optional(),
    closed: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change.');
export type UpdateMilestoneBody = z.infer<typeof updateMilestoneBodySchema>;

// Cycles: time boxes of one project, for teams that plan in sprints.

export const CYCLE_STATES = ['planned', 'active', 'completed'] as const;
export type CycleState = (typeof CYCLE_STATES)[number];

/** At most this many planned cycles wait at once in a project. */
export const MAX_PLANNED_CYCLES = 12;

export const cycleSchema = z.object({
  id: z.uuid(),
  number: z.number().int().positive(),
  name: z.string(),
  startsOn: z.string(),
  endsOn: z.string(),
  capacity: z.number().int().nullable(),
  state: z.enum(CYCLE_STATES),
  /** Its tickets now (not archived, not scrapped): completed, of all. */
  tickets: counts,
  /** The same by estimate, in the project's system. */
  estimate: counts,
  /** Recorded when it started: what was planned. */
  planned: z.object({ tickets: z.number().int(), estimate: z.number().int() }).nullable(),
  /** Recorded when it was completed: what got done. */
  done: z.object({ tickets: z.number().int(), estimate: z.number().int() }).nullable(),
});
export type Cycle = z.infer<typeof cycleSchema>;

export const cycleListSchema = z.object({
  enabled: z.boolean(),
  lengthDays: z.number().int(),
  estimation: z.enum(ESTIMATION_SYSTEMS),
  archived: z.boolean(),
  /** Active first, then planned (earliest first), then completed (latest first). */
  cycles: z.array(cycleSchema),
});
export type CycleList = z.infer<typeof cycleListSchema>;

export const createCycleBodySchema = z
  .strictObject({
    name: singleLineText(80).optional(),
    /** Left out: the day after the last cycle ends, or today. */
    startsOn: calendarDate.optional(),
    /** Left out: the project's cycle length after the start. */
    endsOn: calendarDate.optional(),
    capacity: z.number().int().min(0).max(1_000_000).nullable().optional(),
  })
  .refine(
    (body) => !body.startsOn || !body.endsOn || body.endsOn > body.startsOn,
    'A cycle must end after it starts.',
  );
export type CreateCycleBody = z.infer<typeof createCycleBodySchema>;

export const updateCycleBodySchema = z
  .strictObject({
    name: singleLineText(80).optional(),
    startsOn: calendarDate.optional(),
    endsOn: calendarDate.optional(),
    capacity: z.number().int().min(0).max(1_000_000).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change.');
export type UpdateCycleBody = z.infer<typeof updateCycleBodySchema>;

/** Where a completed cycle's unfinished tickets go: the next planned cycle, or the backlog. */
export const completeCycleBodySchema = z.strictObject({
  unfinished: z.enum(['next', 'backlog']),
});
export type CompleteCycleBody = z.infer<typeof completeCycleBodySchema>;

/** One day of a cycle's burndown: its scope and what was left at the end of that day. */
export const burndownSchema = z.object({
  estimation: z.enum(ESTIMATION_SYSTEMS),
  days: z.array(
    z.object({
      date: z.string(),
      scopeTickets: z.number().int(),
      remainingTickets: z.number().int(),
      scopeEstimate: z.number().int(),
      remainingEstimate: z.number().int(),
    }),
  ),
});
export type Burndown = z.infer<typeof burndownSchema>;

/** A date `days` after a YYYY-MM-DD date, in the same form. */
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// The timeline: a project's epics and milestones on the calendar.

/** At most this many epics are placed on a timeline. */
export const TIMELINE_EPIC_LIMIT = 200;

export const timelineSchema = z.object({
  archived: z.boolean(),
  /** Epics (not archived), by start date (none last), then key. */
  epics: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      status: z.object({
        key: z.string(),
        name: z.string(),
        category: z.enum(['not_started', 'in_progress', 'completed']),
      }),
      startDate: z.string().nullable(),
      dueDate: z.string().nullable(),
      assignee: z.object({ displayName: z.string() }).nullable(),
      /** How far along its descendants are; null when it has none. */
      progress: z
        .object({
          completed: z.number().int(),
          inProgress: z.number().int(),
          jammed: z.number().int(),
          notStarted: z.number().int(),
        })
        .nullable(),
    }),
  ),
  /** Open and closed milestones, by target date (none last). */
  milestones: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      targetDate: z.string().nullable(),
      health: z.enum(MILESTONE_HEALTH),
      closed: z.boolean(),
    }),
  ),
  /** "blocker blocks blocked", between epics on this timeline. */
  dependencies: z.array(z.object({ blocker: z.string(), blocked: z.string() })),
  /** Epics left out past the limit. */
  hiddenEpics: z.number().int().nonnegative(),
});
export type Timeline = z.infer<typeof timelineSchema>;

// Reports: how work has flowed through a project lately.

export const REPORT_RANGES = [30, 90] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

/** How long tickets took, in days: how many, the median and the 85th percentile. */
const durationStatsSchema = z.object({
  count: z.number().int().nonnegative(),
  medianDays: z.number().nullable(),
  p85Days: z.number().nullable(),
});
export type DurationStats = z.infer<typeof durationStatsSchema>;

export const reportsSchema = z.object({
  days: z.union([z.literal(30), z.literal(90)]),
  /** The first and last day covered (UTC), today last. */
  from: z.string(),
  to: z.string(),
  estimation: z.enum(['time', 'points']),
  /** Running totals since the first day: tickets made and tickets done. */
  createdResolved: z.array(
    z.object({ date: z.string(), created: z.number().int(), resolved: z.number().int() }),
  ),
  /** Tickets done each week, weeks starting on Monday (the first may begin before `from`). */
  throughput: z.array(z.object({ weekStart: z.string(), done: z.number().int() })),
  /** At the end of each day: how many tickets were in each kind of status. */
  flow: z.array(
    z.object({
      date: z.string(),
      notStarted: z.number().int(),
      inProgress: z.number().int(),
      done: z.number().int(),
    }),
  ),
  /** Of the tickets done in the range: from made to done, and from first started to done. */
  leadTime: durationStatsSchema,
  cycleTime: durationStatsSchema,
  /** Open tickets and how long they have sat in the status they are in. */
  age: z.object({
    statuses: z.array(
      z.object({
        name: z.string(),
        category: z.enum(['not_started', 'in_progress']),
        count: z.number().int(),
        medianDays: z.number(),
        oldestDays: z.number(),
      }),
    ),
    /** The ten that have waited longest. */
    oldest: z.array(
      z.object({ key: z.string(), title: z.string(), status: z.string(), days: z.number() }),
    ),
  }),
  /** Null when cycles are off for the project. */
  cycles: z
    .object({
      active: z
        .object({
          id: z.uuid(),
          name: z.string(),
          startsOn: z.string(),
          endsOn: z.string(),
          days: burndownSchema.shape.days,
        })
        .nullable(),
      /** The last six completed cycles, oldest first: what was planned and what got done. */
      velocity: z.array(
        z.object({
          name: z.string(),
          plannedTickets: z.number().int(),
          doneTickets: z.number().int(),
          plannedEstimate: z.number().int(),
          doneEstimate: z.number().int(),
        }),
      ),
    })
    .nullable(),
});
export type Reports = z.infer<typeof reportsSchema>;
