import { z } from 'zod';

// What lands in a person's inbox, and which kinds they want.

export const NOTIFICATION_KINDS = [
  'assigned',
  'mentioned',
  'commented',
  'moved',
  'due_soon',
  'overdue',
  'triage_arrival',
  'triage_approval',
  'triage_outcome',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** How each kind is named in settings. */
export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  assigned: 'A ticket is assigned to me',
  mentioned: 'Someone @mentions me',
  commented: 'A comment on a ticket I watch',
  moved: 'A ticket I watch changes status',
  due_soon: 'A ticket of mine is due tomorrow',
  overdue: 'A ticket of mine is overdue',
  triage_arrival: 'A ticket arrives in triage for me',
  triage_approval: 'A triage decision needs my approval',
  triage_outcome: 'A ticket I filed is triaged',
};

/** Every kind is on unless switched off. */
export const notificationPrefsSchema = z
  .strictObject(
    Object.fromEntries(NOTIFICATION_KINDS.map((kind) => [kind, z.boolean()])) as Record<
      NotificationKind,
      z.ZodBoolean
    >,
  )
  .partial();
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

export const wantsNotification = (prefs: NotificationPrefs | undefined, kind: NotificationKind) =>
  prefs?.[kind] !== false;

export const notificationSchema = z.object({
  id: z.uuid(),
  kind: z.enum(NOTIFICATION_KINDS),
  text: z.string(),
  ticket: z.object({ key: z.string(), title: z.string() }),
  workspace: z.object({ id: z.uuid(), slug: z.string() }),
  actor: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  read: z.boolean(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  unread: z.number().int().nonnegative(),
  /** Pass as `before` to get the next, older page; null at the end. */
  next: z.string().nullable(),
});
export type NotificationList = z.infer<typeof notificationListSchema>;

export const markReadBodySchema = z.union([
  z.strictObject({ ids: z.array(z.uuid()).min(1).max(100) }),
  z.strictObject({ all: z.literal(true) }),
]);
export type MarkReadBody = z.infer<typeof markReadBodySchema>;

/** What the live stream sends when something new arrives. */
export const notificationEventSchema = z.object({
  unread: z.number().int().nonnegative(),
  notification: notificationSchema.nullable(),
});
export type NotificationEvent = z.infer<typeof notificationEventSchema>;
