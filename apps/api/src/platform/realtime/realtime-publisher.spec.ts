// Publisher unit contract (ADR-029): what broadcasts where, and — because this rides inside
// every audited mutation — that NOTHING that goes wrong in here can reach the caller.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUDIT_STREAM_TOPIC, ENTITY_CHANGED_EVENT, EntityChangedPayloadSchema } from '@ecms/contracts';

vi.mock('../../infrastructure/config/env', () => ({
  env: { REALTIME_ENABLED: true },
  isTest: true,
}));
vi.mock('../../infrastructure/realtime/socket-server', () => ({
  emitToRoom: vi.fn(),
}));

const { env } = await import('../../infrastructure/config/env');
const flags = env as unknown as { REALTIME_ENABLED: boolean };
const { emitToRoom } = await import('../../infrastructure/realtime/socket-server');
const emitted = vi.mocked(emitToRoom);
const { publishAuditedChange, publishActivity } = await import('./realtime-publisher');

const change = (over: Partial<Parameters<typeof publishAuditedChange>[0]> = {}) => ({
  entityRef: { moduleId: 'hr', entityType: 'employee', entityId: 'e1' },
  action: 'create' as const,
  at: '2026-08-25T10:00:00.000Z',
  ...over,
});

beforeEach(() => {
  emitted.mockReset();
  flags.REALTIME_ENABLED = true;
});

describe('publishAuditedChange', () => {
  it('sends a data change to the audit stream and the entity topic, in the minimal shape', () => {
    publishAuditedChange(change());
    expect(emitted).toHaveBeenCalledTimes(2);
    const rooms = emitted.mock.calls.map(([room]) => room);
    expect(rooms).toEqual([`topic:${AUDIT_STREAM_TOPIC}`, 'topic:hr.employee']);
    for (const [, event, payload] of emitted.mock.calls) {
      expect(event).toBe(ENTITY_CHANGED_EVENT);
      // The payload is the closed minimal vocabulary — a new field here is a design decision,
      // not a convenience, because everything in it reaches every subscriber of the topic.
      expect(EntityChangedPayloadSchema.strict().parse(payload)).toEqual({
        module: 'hr',
        entity: 'employee',
        entityId: 'e1',
        action: 'create',
        at: '2026-08-25T10:00:00.000Z',
      });
    }
  });

  it('adds the branch room only when the call site names a branch', () => {
    publishAuditedChange(change({ branchId: 'b42' }));
    expect(emitted.mock.calls.map(([room]) => room)).toContain('topic:hr.employee:branch:b42');
    emitted.mockReset();
    publishAuditedChange(change({ branchId: null }));
    expect(emitted.mock.calls.map(([room]) => room)).toEqual([
      `topic:${AUDIT_STREAM_TOPIC}`,
      'topic:hr.employee',
    ]);
  });

  it('keeps security telemetry off entity topics — the audit stream still carries it', () => {
    publishAuditedChange(change({ action: 'loginFailed' as never }));
    expect(emitted).toHaveBeenCalledTimes(1);
    expect(emitted.mock.calls[0]?.[0]).toBe(`topic:${AUDIT_STREAM_TOPIC}`);
  });

  it('keeps excluded entities off entity topics', () => {
    publishAuditedChange(
      change({ entityRef: { moduleId: 'platform', entityType: 'notification', entityId: 'n1' } }),
    );
    expect(emitted).toHaveBeenCalledTimes(1);
    expect(emitted.mock.calls[0]?.[0]).toBe(`topic:${AUDIT_STREAM_TOPIC}`);
  });

  it('does not double-send an audit-log entity record to the stream it already rode', () => {
    publishAuditedChange(
      change({
        entityRef: { moduleId: 'platform', entityType: 'auditLog', entityId: 'x' },
        action: 'update',
      }),
    );
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it('broadcasts nothing about an unclassified entity, and does not throw', () => {
    publishAuditedChange(
      change({ entityRef: { moduleId: 'newmod', entityType: 'thing', entityId: 't1' } }),
    );
    expect(emitted).toHaveBeenCalledTimes(1); // audit stream only
  });

  it('is a no-op with the flag off', () => {
    flags.REALTIME_ENABLED = false;
    publishAuditedChange(change());
    expect(emitted).not.toHaveBeenCalled();
  });

  it('never lets a transport failure reach the mutation it rides on', () => {
    emitted.mockImplementation(() => {
      throw new Error('socket exploded');
    });
    expect(() => publishAuditedChange(change())).not.toThrow();
  });
});

describe('publishActivity', () => {
  it('streams to the activity topic only', () => {
    publishActivity({ moduleId: 'hr', entityType: 'employee', entityId: 'e1' }, '2026-08-25T10:00:00.000Z');
    expect(emitted).toHaveBeenCalledTimes(1);
    expect(emitted.mock.calls[0]?.[0]).toBe('topic:platform.activityLog');
  });

  it('is silent with the flag off and safe against transport failure', () => {
    flags.REALTIME_ENABLED = false;
    publishActivity({ moduleId: 'hr', entityType: 'employee', entityId: 'e1' }, 'now');
    expect(emitted).not.toHaveBeenCalled();
    flags.REALTIME_ENABLED = true;
    emitted.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() =>
      publishActivity({ moduleId: 'hr', entityType: 'employee', entityId: 'e1' }, 'now'),
    ).not.toThrow();
  });
});
