// F1/F3 — CSV serialization + field-name-based PII masking (Plan §13).
import { EventEmitter } from 'node:events';
import { type Response } from 'express';
import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AuthContext } from '../../shared/types';
import { settingsService } from '../settings';
import { csvEscape, maskChangeValue, rowToCsv, streamAuditExport } from './audit.export';
import { AuditLogModel, type AuditLogDoc } from './audit.model';
import { auditService } from './audit.service';

describe('csvEscape', () => {
  it('passes plain values through unchanged', () => {
    expect(csvEscape('hello')).toBe('hello');
    expect(csvEscape(42)).toBe('42');
  });

  it('quotes and escapes values containing commas, quotes, or newlines', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  it('renders null/undefined as an empty field', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });
});

describe('maskChangeValue', () => {
  it('masks the nationalId field per the Security Architecture default masking rule', () => {
    expect(maskChangeValue('nationalId', '29801011234567')).toBe('298*******4567');
  });

  it('leaves every other field untouched', () => {
    expect(maskChangeValue('email', 'user@example.com')).toBe('user@example.com');
    expect(maskChangeValue('status', 'active')).toBe('active');
  });

  it('does not attempt to mask a non-string nationalId value', () => {
    expect(maskChangeValue('nationalId', null)).toBe(null);
  });
});

describe('rowToCsv', () => {
  const baseDoc: AuditLogDoc = {
    _id: new Types.ObjectId('64b1f0aaaaaaaaaaaaaaaaaa'),
    entityRef: { moduleId: 'platform', entityType: 'user', entityId: 'u1' },
    action: 'update',
    changes: [{ field: 'nationalId', old: '29801011234567', new: '29801019876543' }],
    actor: { userId: new Types.ObjectId('64b1f0bbbbbbbbbbbbbbbbbb'), ip: '10.0.0.1', userAgent: 'test' },
    requestId: 'req-1',
    at: new Date('2026-07-09T12:00:00.000Z'),
  };

  it('renders one comma-separated row with the changes column masked and JSON-encoded', () => {
    const row = rowToCsv(baseDoc);
    expect(row).toContain('64b1f0aaaaaaaaaaaaaaaaaa');
    expect(row).toContain('platform');
    expect(row).toContain('update');
    expect(row).not.toContain('29801011234567');
    expect(row).toContain('298*******4567');
  });

  it('renders empty fields for a system actor (no userId/ip)', () => {
    const row = rowToCsv({
      ...baseDoc,
      actor: { userId: null, ip: null, userAgent: null },
      requestId: null,
    });
    const fields = row.split(',');
    expect(fields[5]).toBe(''); // actorUserId
    expect(fields[6]).toBe(''); // actorIp
  });
});

describe('streamAuditExport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Takes the header and ten rows, then fills up, and its client leaves before it drains. */
  class LeavingResponse extends EventEmitter {
    destroyed = false;
    writes = 0;
    readonly end = vi.fn();
    setHeader(): void {}
    write(): boolean {
      this.writes += 1;
      if (this.writes <= 11) return true;
      setImmediate(() => {
        this.destroyed = true;
        this.emit('close');
      });
      return false;
    }
  }

  it('stops reading the log when the client leaves, and audits the rows it wrote', async () => {
    const logs = 1_000;
    let read = 0;
    async function* rows(): AsyncGenerator<AuditLogDoc> {
      for (let i = 0; i < logs; i += 1) {
        read += 1;
        yield {
          _id: new Types.ObjectId(),
          entityRef: { moduleId: 'platform', entityType: 'user', entityId: `u${i}` },
          action: 'update',
          changes: [],
          actor: { userId: null, ip: null, userAgent: null },
          requestId: null,
          at: new Date('2026-07-09T12:00:00.000Z'),
        };
      }
    }
    // A real query cursor has `close()`, which frees the cursor on the server.
    const close = vi.fn().mockResolvedValue(undefined);
    const cursor = () => Object.assign(rows(), { close });
    const query = { sort: () => query, limit: () => query, lean: () => query, cursor };
    vi.spyOn(AuditLogModel, 'find').mockReturnValue(query as never);
    vi.spyOn(settingsService, 'resolve').mockResolvedValue(50_000);
    const record = vi.spyOn(auditService, 'record').mockResolvedValue();
    const res = new LeavingResponse();
    const ctx = { userId: 'u1', branchId: null, permissions: {} } as unknown as AuthContext;

    const outcome = await Promise.race([
      streamAuditExport(res as unknown as Response, ctx, {}).then(() => 'ended'),
      new Promise<string>((resolve) => setTimeout(() => resolve('still waiting'), 5_000)),
    ]);

    expect(outcome).toBe('ended');
    // Row eleven was the write that found the buffer full; nothing past it was read.
    expect(read).toBe(11);
    expect(res.end).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0]?.[0].changes).toContainEqual({
      field: 'rowCount',
      old: null,
      new: 10,
    });
    // The audit row says the count is partial, and the cursor was closed rather than left open.
    expect(record.mock.calls[0]?.[0].changes).toContainEqual({
      field: 'completed',
      old: null,
      new: false,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('audits the rows already sent when the read fails part-way, then lets the error through', async () => {
    // A cursor the server timed out while a paused client held the download, say. Before, the
    // error skipped the audit row, so pausing a large download was a way to export unaudited.
    async function* rows(): AsyncGenerator<AuditLogDoc> {
      for (let i = 0; i < 100; i += 1) {
        if (i === 7) throw Object.assign(new Error('cursor id 42 not found'), { code: 43 });
        yield {
          _id: new Types.ObjectId(),
          entityRef: { moduleId: 'platform', entityType: 'user', entityId: `u${i}` },
          action: 'update',
          changes: [],
          actor: { userId: null, ip: null, userAgent: null },
          requestId: null,
          at: new Date('2026-07-09T12:00:00.000Z'),
        };
      }
    }
    const close = vi.fn().mockResolvedValue(undefined);
    const cursor = () => Object.assign(rows(), { close });
    const query = { sort: () => query, limit: () => query, lean: () => query, cursor };
    vi.spyOn(AuditLogModel, 'find').mockReturnValue(query as never);
    vi.spyOn(settingsService, 'resolve').mockResolvedValue(50_000);
    const record = vi.spyOn(auditService, 'record').mockResolvedValue();
    const res = Object.assign(new EventEmitter(), {
      destroyed: false,
      setHeader: () => undefined,
      write: () => true,
      end: vi.fn(),
    });
    const ctx = { userId: 'u1', branchId: null, permissions: {} } as unknown as AuthContext;

    await expect(streamAuditExport(res as unknown as Response, ctx, {})).rejects.toMatchObject({
      code: 43,
    });
    expect(record).toHaveBeenCalledOnce();
    const changes = record.mock.calls[0]?.[0].changes;
    expect(changes).toContainEqual({ field: 'rowCount', old: null, new: 7 });
    expect(changes).toContainEqual({ field: 'completed', old: null, new: false });
    expect(close).toHaveBeenCalledOnce();
    // The response is left to the error handler, not ended as if it were a whole file.
    expect(res.end).not.toHaveBeenCalled();
  });
});
