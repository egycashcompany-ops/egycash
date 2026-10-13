// The redaction list is the logger's half of D3 (spec §5.4): the register's five secret field names
// are censored at the root, one level and two levels deep. Checked through a REAL pino instance
// built with the exported list and writing to memory — the paths are pino's syntax, and only pino
// can say whether it accepts and applies them. Every value below is synthetic.
import { Writable } from 'node:stream';
import { pino, type Logger } from 'pino';
import { describe, expect, it } from 'vitest';
import { PII_REDACTION_PATHS, REGISTER_SECRET_FIELD_NAMES } from './logger';

const captureLine = (log: (instance: Logger) => void): Record<string, unknown> => {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk.toString('utf8'));
      done();
    },
  });
  const instance = pino(
    { level: 'info', base: null, redact: { paths: PII_REDACTION_PATHS, censor: '[REDACTED]' } },
    sink,
  );
  log(instance);
  return JSON.parse(chunks.join('')) as Record<string, unknown>;
};

const FAKE = 'synthetic-value-0000';

describe('logger redaction paths', () => {
  it('lists each register secret name at three depths (15 paths)', () => {
    for (const name of REGISTER_SECRET_FIELD_NAMES) {
      expect(PII_REDACTION_PATHS).toContain(name);
      expect(PII_REDACTION_PATHS).toContain(`*.${name}`);
      expect(PII_REDACTION_PATHS).toContain(`*.*.${name}`);
    }
    expect(REGISTER_SECRET_FIELD_NAMES).toHaveLength(5);
  });

  it('redacts the five names at the root', () => {
    const line = captureLine((log) => {
      log.info(Object.fromEntries(REGISTER_SECRET_FIELD_NAMES.map((n) => [n, FAKE])), 'root');
    });
    for (const name of REGISTER_SECRET_FIELD_NAMES) expect(line[name]).toBe('[REDACTED]');
    expect(JSON.stringify(line)).not.toContain(FAKE);
  });

  it('redacts the five names one level deep', () => {
    const line = captureLine((log) => {
      log.info(
        { entry: Object.fromEntries(REGISTER_SECRET_FIELD_NAMES.map((n) => [n, FAKE])) },
        'one',
      );
    });
    const entry = line.entry as Record<string, unknown>;
    for (const name of REGISTER_SECRET_FIELD_NAMES) expect(entry[name]).toBe('[REDACTED]');
    expect(JSON.stringify(line)).not.toContain(FAKE);
  });

  it('redacts the five names two levels deep', () => {
    const line = captureLine((log) => {
      log.info(
        { req: { body: Object.fromEntries(REGISTER_SECRET_FIELD_NAMES.map((n) => [n, FAKE])) } },
        'two',
      );
    });
    const body = (line.req as Record<string, Record<string, unknown>>).body ?? {};
    for (const name of REGISTER_SECRET_FIELD_NAMES) expect(body[name]).toBe('[REDACTED]');
    expect(JSON.stringify(line)).not.toContain(FAKE);
  });

  it('redacts a whole nested keys object, not just its leaves', () => {
    const line = captureLine((log) => {
      log.info({ entry: { keys: { supervisorCode: FAKE, cashUnitCode: FAKE } } }, 'object');
    });
    expect((line.entry as Record<string, unknown>).keys).toBe('[REDACTED]');
    expect(JSON.stringify(line)).not.toContain(FAKE);
  });

  it('leaves unrelated fields alone', () => {
    const line = captureLine((log) => {
      log.info({ entryId: 'abc', counts: { rotated: 2 } }, 'plain');
    });
    expect(line.entryId).toBe('abc');
    expect(line.counts).toEqual({ rotated: 2 });
  });
});
