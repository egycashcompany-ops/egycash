// HR announcements — a message a human writes, addressed to people rather than to an event.
//
// Everything the platform notifies about today is a CONSEQUENCE: a leave request was decided, a
// contract expired, a role changed. An announcement is the other kind — the company is closed on
// Thursday, the new payroll cut-off is the 25th — and it is the one notification whose recipients
// are chosen rather than derived. That choice is this file's subject.
import { z } from 'zod';
import { EMPLOYEE_STATUSES } from './hr-employee.js';
import { EMPLOYMENT_TYPES } from './hr-job-offer.js';
import { GENDERS, MARITAL_STATUSES } from './hr-recruitment.js';
import { NotificationChannelSchema } from '../platform/notifications.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be an id');
const ids = z.array(objectId).min(1).max(500);

/**
 * An AND of ORs, and both halves are deliberate.
 *
 * Every criterion given must hold (AND), and within one criterion any listed value qualifies (OR).
 * That is how the sentence a person means comes out: "the drivers and the guards, in Maadi and
 * Giza" is two criteria, each with two values — not four separate sends, and not everyone who is
 * either a driver or in Maadi.
 *
 * EVERY FIELD IS OPTIONAL, AND AN EMPTY FILTER IS NOT "EVERYONE". `{}` is refused by
 * `AnnouncementAudienceSchema` below: reaching the whole company has to be the explicit
 * `everyone` audience, so it can never be what somebody gets by clearing a filter and not
 * noticing.
 */
export const EmployeeAudienceFilterSchema = z
  .object({
    // Organisational placement — the denormalised fields that also back the data scopes, so a
    // filter and the caller's own ceiling are asked of the same three fields.
    branchIds: ids.optional(),
    departmentIds: ids.optional(),
    sectionIds: ids.optional(),
    jobTitleIds: ids.optional(),
    managerIds: ids.optional(),
    employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).min(1).optional(),
    /**
     * Personal attributes.
     *
     * `religion` earns its place: Egyptian labour law gives Christian employees their own holidays,
     * and an Eid or a Christmas greeting addressed to everybody is the wrong message to half the
     * company. It is stored on the employee file already; this only reads it.
     */
    genders: z.array(z.enum(GENDERS)).min(1).optional(),
    religions: z.array(z.string().trim().min(1).max(60)).min(1).max(20).optional(),
    nationalities: z.array(z.string().trim().min(1).max(60)).min(1).max(20).optional(),
    maritalStatuses: z.array(z.enum(MARITAL_STATUSES)).min(1).optional(),
    /**
     * Employment status. Omitted means the employed ones — anybody whose employment has ENDED is
     * excluded unless they are asked for by name here, because a login can outlive an exit and a
     * company announcement is not for somebody who left in March.
     */
    statuses: z.array(z.enum(EMPLOYEE_STATUSES)).min(1).optional(),
  })
  .strict();
export type EmployeeAudienceFilter = z.infer<typeof EmployeeAudienceFilterSchema>;

/**
 * The same filter, refusing `{}`.
 *
 * The check lives on the FIELD rather than on the union member because a discriminated union's
 * members must be plain objects — and putting it here is better anyway: the error points at
 * `filter`, which is the thing that is empty.
 */
const NonEmptyEmployeeAudienceFilterSchema = EmployeeAudienceFilterSchema.refine(
  (filter) => Object.keys(filter).length > 0,
  { message: 'a filter audience needs at least one criterion — use "everyone" to reach everybody' },
);

/**
 * Who a message is for. Three shapes, and the widest one has to be said out loud.
 *
 * `everyone` is a separate case rather than an empty filter precisely because it is the dangerous
 * one: a filter that silently matched the whole company because its last criterion was removed is
 * the mistake this shape makes unrepresentable.
 */
export const AnnouncementAudienceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('everyone') }).strict(),
  z.object({ kind: z.literal('employees'), employeeIds: ids }).strict(),
  z.object({ kind: z.literal('filter'), filter: NonEmptyEmployeeAudienceFilterSchema }).strict(),
]);
export type AnnouncementAudience = z.infer<typeof AnnouncementAudienceSchema>;

/**
 * What a sender writes — ONE text, not a pair.
 *
 * Everything else in ECMS is authored in both languages, and for catalog data that is right: a job
 * title or a branch name is read by whoever opens the screen, in whatever language they read.
 *
 * An announcement is not catalog data. It is one person writing one message to their colleagues,
 * at the moment they need to send it, and asking them for an English translation of it made the
 * form twice as long for a company that works in Arabic. It also made the English half optional in
 * practice and mandatory in the schema, which is how a send gets blocked at 11pm over a sentence
 * nobody will read.
 *
 * The message is delivered to every recipient as written. `send-localised` still exists and still
 * splits by reading language — a rule's message or a future translated announcement can use it —
 * but an announcement now hands it the same text for both sides, which is the honest description
 * of what was actually written.
 */
export const CreateAnnouncementSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(4000),
    audience: AnnouncementAudienceSchema,
    priority: z.enum(['low', 'normal', 'high']).default('normal'),
    channels: z.array(NotificationChannelSchema).min(1).optional(),
  })
  .strict();
export type CreateAnnouncement = z.infer<typeof CreateAnnouncementSchema>;

/** Resolving an audience without sending anything — the count a sender sees before committing. */
export const PreviewAnnouncementAudienceSchema = z
  .object({ audience: AnnouncementAudienceSchema })
  .strict();
export type PreviewAnnouncementAudience = z.infer<typeof PreviewAnnouncementAudienceSchema>;

/**
 * What an audience actually resolves to, before a single notification is created.
 *
 * `unreachable` is the number this exists for. An audience is chosen in EMPLOYEES and delivered to
 * LOGINS, and the two are not the same set — a company of 300 with 180 accounts means a
 * company-wide announcement reaches 180 people. Reporting only `recipients` would let somebody
 * announce a closure to "everyone" and be wrong about it in a way nothing tells them.
 */
export interface AudiencePreviewDto {
  /** Employees the audience matched, within the sender's own scope. */
  matched: number;
  /** Of those, the ones with a login — the people who will actually be notified. */
  recipients: number;
  /** Of those, the ones with no login account, who cannot be reached at all. */
  unreachable: number;
  /** A handful of matched names, so a sender can sanity-check the filter before sending. */
  sample: { id: string; code: string; name: string }[];
  /** True when the sender's data scope narrowed the audience below what they asked for. */
  narrowedByScope: boolean;
}

export interface AnnouncementDto {
  id: string;
  /** As written — one text, the same one every recipient was sent. */
  title: string;
  body: string;
  audience: AnnouncementAudience;
  priority: string;
  channels: string[];
  /** What it resolved to at SEND time — a filter re-run later would not give the same answer. */
  matched: number;
  recipients: number;
  unreachable: number;
  sentBy: string;
  sentByName: string | null;
  sentAt: string;
}

export const ListAnnouncementsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type ListAnnouncementsQuery = z.infer<typeof ListAnnouncementsQuerySchema>;

/** The template every announcement renders through, seeded by the HR module at boot. */
export const ANNOUNCEMENT_TEMPLATE_KEY = 'hr.announcement';

/**
 * The values the audience builder offers for the two free-text personal criteria.
 *
 * Read from the employee files that exist rather than declared here: `religion` and `nationality`
 * are typed in by whoever registers an employee, so a hardcoded list would silently fail to match
 * the day somebody spells one differently.
 */
export interface AudienceOptionsDto {
  religions: string[];
  nationalities: string[];
}
