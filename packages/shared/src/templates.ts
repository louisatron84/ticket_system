import { z } from 'zod';
import { hasControlCharacter, singleLineText } from './text';
import { MAX_CRITERIA, MAX_CRITERION_LENGTH, MAX_GOAL_LENGTH } from './tickets';

// Ticket templates (P4): per project, picked on the create form, which they fill. A template is
// never remembered on the ticket it filled.

/** At most this many templates per project. */
export const MAX_TEMPLATES = 20;
export const MAX_TEMPLATE_NAME_LENGTH = 60;
export const MAX_TITLE_PREFIX_LENGTH = 60;

const LINE_BREAKS_AND_TABS = [0x09, 0x0a, 0x0d];

/** Free text over several lines, as on a ticket. Not trimmed; may be empty. */
const multiLineText = (max: number) =>
  z
    .string()
    .max(max)
    .refine(
      (value) => !hasControlCharacter(value, LINE_BREAKS_AND_TABS),
      'Must not contain control characters.',
    );

// The same limits as the create-ticket body, so whatever a template fills in can be sent as is.
const templateFields = {
  name: singleLineText(MAX_TEMPLATE_NAME_LENGTH),
  /** Goes before the title the person types, such as "[Bug]". Trimmed; empty means none. */
  titlePrefix: z
    .string()
    .trim()
    .max(MAX_TITLE_PREFIX_LENGTH)
    .refine((value) => !hasControlCharacter(value), 'Must not contain control characters.'),
  typeId: z.uuid().nullable(),
  priorityId: z.uuid().nullable(),
  componentId: z.uuid().nullable(),
  labelIds: z
    .array(z.uuid())
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length, 'Each label may be listed only once.'),
  goal: multiLineText(MAX_GOAL_LENGTH),
  criteria: z.array(singleLineText(MAX_CRITERION_LENGTH)).max(MAX_CRITERIA),
  description: multiLineText(20_000),
};

/** A name, plus any of the rest; what is left out stays empty. */
export const createTemplateBodySchema = z.strictObject({
  name: templateFields.name,
  titlePrefix: templateFields.titlePrefix.optional(),
  typeId: templateFields.typeId.optional(),
  priorityId: templateFields.priorityId.optional(),
  componentId: templateFields.componentId.optional(),
  labelIds: templateFields.labelIds.optional(),
  goal: templateFields.goal.optional(),
  criteria: templateFields.criteria.optional(),
  description: templateFields.description.optional(),
});
export type CreateTemplateBody = z.infer<typeof createTemplateBodySchema>;

export const updateTemplateBodySchema = createTemplateBodySchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change.');
export type UpdateTemplateBody = z.infer<typeof updateTemplateBodySchema>;

/** Every template of the project, each once, in the new order. */
export const reorderTemplatesBodySchema = z.strictObject({
  ids: z
    .array(z.uuid())
    .max(MAX_TEMPLATES)
    .refine((ids) => new Set(ids).size === ids.length, 'Each template may be listed only once.'),
});
export type ReorderTemplatesBody = z.infer<typeof reorderTemplatesBodySchema>;

export const ticketTemplateSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  titlePrefix: z.string(),
  typeId: z.uuid().nullable(),
  priorityId: z.uuid().nullable(),
  componentId: z.uuid().nullable(),
  /** Labels that still exist; a deleted label drops out of the template. */
  labelIds: z.array(z.uuid()),
  goal: z.string(),
  criteria: z.array(z.string()),
  description: z.string(),
});
export type TicketTemplate = z.infer<typeof ticketTemplateSchema>;
