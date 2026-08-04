// The actor snapshot must cost NOTHING on the write path.
//
// Every audited mutation writes a row, so a lookup per row is a lookup per mutation — and once
// job titles are involved that is several. An authenticated caller was already named once when
// their token was verified, so the identity travels on the request and the write just copies it.
// These tests count the lookups rather than trusting the shape of the code.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookups = { count: 0 };
const rows: Record<string, unknown>[] = [];

vi.mock('../directory/directory-profile.service', () => ({
  directoryProfileService: {
    get: async (userId: string) => {
      lookups.count += 1;
      return {
        userId,
        displayName: { ar: 'من قاعدة البيانات', en: 'From the database' },
        avatarFileId: null,
        jobTitle: { ar: 'مسمى', en: 'Title' },
        department: null,
        branch: null,
        active: true,
        workEmail: null,
      };
    },
  },
}));

vi.mock('./audit.model', () => ({
  AuditLogModel: { create: async (docs: Record<string, unknown>[]) => void rows.push(...docs) },
  ActivityLogModel: { create: async (docs: Record<string, unknown>[]) => void rows.push(...docs) },
}));

// No Redis in a unit test: enqueue rejects, so `record` takes its in-request fallback and the row
// is written before the assertion runs.
vi.mock('../../infrastructure/queue/jobs', () => ({
  enqueue: async () => {
    throw new Error('no queue');
  },
  registerJobHandler: () => undefined,
}));

const { auditService } = await import('./audit.service');
const { runWithContext } = await import('../../infrastructure/http/request-context');

const ACTOR = '6a71ba261db68a923e529c01';
const IDENTITY = {
  displayName: { ar: 'أحمد سالم', en: 'Ahmed Salem' },
  jobTitle: { ar: 'أخصائي موارد بشرية', en: 'HR Specialist' },
  avatarFileId: null,
};
const entry = {
  entityRef: { moduleId: 'platform', entityType: 'user', entityId: ACTOR },
  action: 'update' as const,
};

const snapshotOf = (row: Record<string, unknown> | undefined): Record<string, unknown> | null =>
  (row?.actorSnapshot as Record<string, unknown> | null) ?? null;

describe('actor snapshot capture', () => {
  beforeEach(() => {
    lookups.count = 0;
    rows.length = 0;
  });

  it('costs no lookup when the request already knows who is acting', async () => {
    await runWithContext(
      {
        requestId: 'req_1',
        actor: { userId: ACTOR, ip: null, userAgent: null, identity: IDENTITY },
      },
      async () => auditService.record(entry),
    );

    expect(lookups.count).toBe(0);
    expect(snapshotOf(rows[0])?.displayName).toEqual(IDENTITY.displayName);
  });

  it('still names the actor when nothing on the request could — logging in, background work', async () => {
    await runWithContext({ requestId: 'req_2', actor: { userId: ACTOR, ip: null, userAgent: null } }, async () =>
      auditService.record(entry),
    );

    expect(lookups.count).toBe(1);
    expect(snapshotOf(rows[0])?.displayName).toEqual({
      ar: 'من قاعدة البيانات',
      en: 'From the database',
    });
  });

  it('never lends one person’s identity to another', async () => {
    // The request is Ahmed's; the entry names someone else. Copying the context here would put the
    // wrong name in the audit trail, which is worse than a lookup.
    await runWithContext(
      {
        requestId: 'req_3',
        actor: { userId: ACTOR, ip: null, userAgent: null, identity: IDENTITY },
      },
      async () =>
        auditService.record({
          ...entry,
          actor: { userId: '6a71ba261db68a923e529c02', ip: null, userAgent: null },
        }),
    );

    expect(lookups.count).toBe(1);
    expect(snapshotOf(rows[0])?.displayName).not.toEqual(IDENTITY.displayName);
  });

  it('writes no snapshot at all for system work with no actor', async () => {
    await runWithContext({ requestId: 'req_4' }, async () => auditService.record(entry));

    expect(lookups.count).toBe(0);
    expect(snapshotOf(rows[0])).toBeNull();
  });

  it('applies the same rule to the activity log', async () => {
    await runWithContext(
      {
        requestId: 'req_5',
        actor: { userId: ACTOR, ip: null, userAgent: null, identity: IDENTITY },
      },
      async () =>
        auditService.recordActivity({
          entityRef: entry.entityRef,
          messageKey: 'employee.updated',
        }),
    );

    expect(lookups.count).toBe(0);
    expect(snapshotOf(rows[0])?.displayName).toEqual(IDENTITY.displayName);
  });
});
