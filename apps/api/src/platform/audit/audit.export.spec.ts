// F1/F3 — CSV serialization + field-name-based PII masking (Plan §13).
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { csvEscape, maskChangeValue, rowToCsv } from './audit.export';
import { type AuditLogDoc } from './audit.model';

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
