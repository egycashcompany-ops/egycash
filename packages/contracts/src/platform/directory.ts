// Platform Directory — "who is this person", for anyone already inside the system.
//
// This is NOT user administration and is deliberately not gated on `user.view`: someone who can
// see that an action happened has to be able to see who did it. The precedent is the identity card
// in Azure DevOps, GitHub and Jira.
//
// The DTO below is CLOSED and has no structural relationship to the user entity or to the
// users-admin response. That is the point: a field added to the user model must require an explicit
// decision to appear here, and only a separate type makes that true. A test asserts the response
// keys are exactly this set, so widening it fails a test instead of leaking quietly.
import { z } from 'zod';
import { LocalizedStringSchema, objectId, type LocalizedString } from '../common/index.js';

/** What the card may show. Nothing about permissions, roles, personal contact, or settings. */
export interface DirectoryProfileDto {
  userId: string;
  displayName: LocalizedString;
  /** File id of the person's photo, when one exists. */
  avatarFileId: string | null;
  jobTitle: LocalizedString | null;
  department: LocalizedString | null;
  branch: LocalizedString | null;
  /** Only because the system already exposes this state elsewhere. */
  active: boolean;
  /** The internal work address the system already displays; never a personal one. */
  workEmail: string | null;
}

/** The exact key set the endpoint may return — the deny-list, expressed positively. */
export const DIRECTORY_PROFILE_KEYS = [
  'userId',
  'displayName',
  'avatarFileId',
  'jobTitle',
  'department',
  'branch',
  'active',
  'workEmail',
] as const;

export const DirectoryProfileIdParamSchema = z.object({ userId: objectId() }).strict();

/** Batch read — one request resolves everyone a page mentions. */
export const ResolveDirectoryProfilesSchema = z
  .object({ userIds: z.array(objectId()).min(1).max(200) })
  .strict();
export type ResolveDirectoryProfiles = z.infer<typeof ResolveDirectoryProfilesSchema>;

// ── Actor snapshot ──────────────────────────────────────────────────────────

/**
 * Who did it, recorded WHEN it happened.
 *
 * History states what was true at the time; it is not a view onto who that person is today. A join
 * at read time would let a rename, a transfer or a deletion silently rewrite the past, so every
 * event stream stores this instead of only an id. `userId` is kept so the Directory can still be
 * opened while the account exists.
 */
export const ActorSnapshotSchema = z
  .object({
    userId: objectId().nullable(),
    displayName: LocalizedStringSchema,
    jobTitle: LocalizedStringSchema.nullable().default(null),
    avatarFileId: z.string().nullable().default(null),
    deletedAt: z.coerce.date().nullable().default(null),
  })
  .strict();
export type ActorSnapshot = z.infer<typeof ActorSnapshotSchema>;

export interface ActorSnapshotDto {
  userId: string | null;
  displayName: LocalizedString;
  jobTitle: LocalizedString | null;
  avatarFileId: string | null;
  deletedAt: string | null;
}
