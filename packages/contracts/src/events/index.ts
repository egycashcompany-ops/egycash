// Event name constants + versioned payload schemas (ADR-008, Review R22).
// Every envelope carries `schemaVersion`; consumers are tolerant readers — payload schemas
// are parsed NON-strict (unknown fields ignored), unlike API input which is `.strict()`.
// Breaking payload changes require a new version constant and a deprecation window.
import { z } from 'zod';
import { objectId, DataScopeSchema } from '../common/index.js';

export const EventEnvelopeSchema = z.object({
  /** Unique event id — consumers dedup on it (idempotency, ADR-008). */
  id: z.string().min(1),
  name: z.string().min(1),
  schemaVersion: z.number().int().min(1),
  occurredAt: z.coerce.date(),
  requestId: z.string().optional(),
  actorId: z.string().optional(),
  payload: z.unknown(),
});
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

/** `<module>.<entity>.<pastTenseEvent>`; platform events use the `platform.` prefix. */
export const PlatformEvents = {
  UserCreated: 'platform.user.created',
  UserUpdated: 'platform.user.updated',
  UserStatusChanged: 'platform.user.statusChanged',

  AuthLoggedIn: 'platform.auth.loggedIn',
  AuthLoginFailed: 'platform.auth.loginFailed',
  AuthSessionRevoked: 'platform.auth.sessionRevoked',
  AuthRefreshReuseDetected: 'platform.auth.refreshReuseDetected',

  RoleChanged: 'platform.role.changed',
  RoleAssignmentChanged: 'platform.roleAssignment.changed',

  OrganizationUpdated: 'platform.organization.updated',
  OrgUnitChanged: 'platform.orgUnit.changed',

  SettingsChanged: 'platform.settings.changed',
} as const;
export type PlatformEventName = (typeof PlatformEvents)[keyof typeof PlatformEvents];

// ── Payload schemas, v1 ─────────────────────────────────────────────────────

export const UserEventPayloadV1 = z.object({
  userId: objectId(),
  email: z.string(),
  status: z.string(),
});

export const AuthEventPayloadV1 = z.object({
  userId: objectId().optional(),
  email: z.string().optional(),
  sessionId: z.string().optional(),
  reason: z.string().optional(),
});

export const RoleAssignmentChangedPayloadV1 = z.object({
  userId: objectId(),
  roleId: objectId(),
  scope: DataScopeSchema.optional(),
  change: z.enum(['granted', 'revoked', 'updated']),
});

export const OrgUnitChangedPayloadV1 = z.object({
  unitType: z.enum(['branch', 'department', 'section', 'jobTitle']),
  unitId: objectId(),
  change: z.enum(['created', 'updated', 'deleted']),
});

export const SettingsChangedPayloadV1 = z.object({
  key: z.string(),
  scope: z.enum(['organization', 'branch', 'user']),
  scopeRef: z.string().nullable(),
});

/** Current schema version per event name — bumped only via a new versioned constant. */
export const EVENT_SCHEMA_VERSIONS: Record<PlatformEventName, number> = {
  [PlatformEvents.UserCreated]: 1,
  [PlatformEvents.UserUpdated]: 1,
  [PlatformEvents.UserStatusChanged]: 1,
  [PlatformEvents.AuthLoggedIn]: 1,
  [PlatformEvents.AuthLoginFailed]: 1,
  [PlatformEvents.AuthSessionRevoked]: 1,
  [PlatformEvents.AuthRefreshReuseDetected]: 1,
  [PlatformEvents.RoleChanged]: 1,
  [PlatformEvents.RoleAssignmentChanged]: 1,
  [PlatformEvents.OrganizationUpdated]: 1,
  [PlatformEvents.OrgUnitChanged]: 1,
  [PlatformEvents.SettingsChanged]: 1,
};
