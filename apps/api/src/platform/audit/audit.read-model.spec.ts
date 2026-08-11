// P11 · G-1 and G-2 — what an audit row looks like on the way OUT.
//
// Both guards exist because P11 puts a screen on `GET /platform/audit-logs`, and both were
// invisible while nothing read it:
//
//   • **G-1.** The masking rule lived inside `audit.export.ts`, so it was the CSV's rule rather than
//     the audit stream's. `toAuditDto` returned raw change values. Two readers of identical rows,
//     two different answers about what may be shown — and the screen would have been the weaker one.
//   • **G-2.** The row has stored `actorSnapshot` since actor snapshots shipped, and both sibling
//     DTOs returned it. This one did not, leaving a reader with an id and no way to name it except
//     by resolving the User at READ time — precisely what the stored snapshot exists to prevent: a
//     rename, a transfer or a deletion would silently rewrite the past.
//
// Pure mapping, so it is tested directly. Nothing here needs Mongo, and the integration suite
// proves the same two properties over real HTTP.
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { auditService } from './audit.service';
import { maskChangeValue, maskChanges, MASKED_FIELDS } from './audit.masking';
import { rowToCsv } from './audit.export';
import { type AuditLogDoc } from './audit.model';

const NATIONAL_ID = '29001010101234';

const row = (over: Partial<AuditLogDoc> = {}): AuditLogDoc =>
  ({
    _id: new Types.ObjectId(),
    entityRef: { moduleId: 'hr', entityType: 'employee', entityId: 'e-1' },
    action: 'update',
    changes: [{ field: 'nationalId', old: NATIONAL_ID, new: '29001010109999' }],
    actor: { userId: new Types.ObjectId(), ip: '10.0.0.1', userAgent: 'Firefox' },
    actorSnapshot: {
      displayName: { ar: 'سارة', en: 'Sara' },
      jobTitle: { ar: 'مديرة', en: 'Manager' },
      avatarFileId: 'f-1',
      deletedAt: null,
    },
    requestId: 'req-1',
    at: new Date('2026-08-01T10:00:00.000Z'),
    ...over,
  }) as AuditLogDoc;

describe('G-1 — the list and the export mask the same things', () => {
  it('masks a national id in the list DTO, which it did not before', () => {
    const dto = auditService.toAuditDto(row());
    expect(dto.changes[0]?.old).not.toBe(NATIONAL_ID);
    expect(String(dto.changes[0]?.old)).toContain('*');
  });

  // The property that matters is not "the list masks" but "the two agree" — a future change to one
  // of them fails here rather than silently making one reader weaker again.
  it('produces the same masked value in the CSV and in the DTO', () => {
    const doc = row();
    const dto = auditService.toAuditDto(doc);
    const csv = rowToCsv(doc);
    expect(csv).toContain(String(dto.changes[0]?.old));
    expect(csv).not.toContain(NATIONAL_ID);
  });

  it('leaves a field nobody asked to mask exactly as it was', () => {
    const dto = auditService.toAuditDto(
      row({ changes: [{ field: 'email', old: 'a@b.c', new: 'd@e.f' }] }),
    );
    expect(dto.changes[0]).toEqual({ field: 'email', old: 'a@b.c', new: 'd@e.f' });
  });

  it('masks both sides of a change, not only the new value', () => {
    const masked = maskChanges([{ field: 'nationalId', old: NATIONAL_ID, new: NATIONAL_ID }]);
    expect(masked[0]?.old).not.toBe(NATIONAL_ID);
    expect(masked[0]?.new).not.toBe(NATIONAL_ID);
  });

  it('leaves a non-string value alone rather than stringifying it', () => {
    expect(maskChangeValue('nationalId', null)).toBeNull();
    expect(maskChangeValue('nationalId', 42)).toBe(42);
  });

  /**
   * The documented limit, pinned so it is a decision rather than a surprise: the rule matches the
   * EXACT field name and not a dotted path. P11 deliberately did not widen it — that would change
   * the CSV's output as a side effect of building a screen. In practice `employee.service` already
   * stores `'[masked]'` under that path at write time.
   */
  it('does not reach into a dotted path — stated, not assumed', () => {
    expect(MASKED_FIELDS.has('nationalId')).toBe(true);
    expect(maskChangeValue('personal.nationalId', NATIONAL_ID)).toBe(NATIONAL_ID);
  });
});

describe('G-2 — the DTO carries who they were at the time', () => {
  it('returns the stored snapshot rather than an id alone', () => {
    const dto = auditService.toAuditDto(row());
    expect(dto.actorSnapshot?.displayName).toEqual({ ar: 'سارة', en: 'Sara' });
    expect(dto.actorSnapshot?.jobTitle).toEqual({ ar: 'مديرة', en: 'Manager' });
  });

  it('carries the actor id inside the snapshot, so a reader can still open the profile', () => {
    const doc = row();
    const dto = auditService.toAuditDto(doc);
    expect(dto.actorSnapshot?.userId).toBe(String(doc.actor.userId));
  });

  // Rows written before snapshots existed. `null` means "this row never recorded who" — not "the
  // system does not know", and certainly not a reason to look the user up now.
  it('answers null for a row that predates actor snapshots', () => {
    expect(auditService.toAuditDto(row({ actorSnapshot: null })).actorSnapshot).toBeNull();
  });

  /**
   * A system-actor row — a sweep, a scheduled job, a login before the context knows anyone.
   * `captureActor` returns null when there is no user, so such a row carries no snapshot at all;
   * the pair is written together and this asserts them together rather than inventing a row with
   * a snapshot but no user, which the writer cannot produce.
   */
  it('answers null for a system-actor row with no user behind it', () => {
    const dto = auditService.toAuditDto(
      row({ actor: { userId: null, ip: null, userAgent: null }, actorSnapshot: null }),
    );
    expect(dto.actorSnapshot).toBeNull();
    expect(dto.actor.userId).toBeNull();
  });

  it('keeps ip and user agent on the DTO — the screen shows them in the detail panel only', () => {
    const dto = auditService.toAuditDto(row());
    expect(dto.actor.ip).toBe('10.0.0.1');
    expect(dto.actor.userAgent).toBe('Firefox');
  });
});
