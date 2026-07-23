import { describe, expect, it } from 'vitest';
import { CreateEvaluationPhaseSchema, DecideEvaluationSchema } from './hr-evaluation.js';

describe('CreateEvaluationPhaseSchema', () => {
  it('accepts a valid phase and defaults driversOnly to false', () => {
    const parsed = CreateEvaluationPhaseSchema.safeParse({
      key: 'securityCheck',
      name: { en: 'Security Check', ar: 'الفحص الأمني' },
      order: 1,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.driversOnly).toBe(false);
  });

  it('rejects a malformed key and an out-of-range order', () => {
    expect(
      CreateEvaluationPhaseSchema.safeParse({ key: '1bad', name: { en: 'x', ar: 'x' }, order: 1 }).success,
    ).toBe(false);
    expect(
      CreateEvaluationPhaseSchema.safeParse({ key: 'ok', name: { en: 'x', ar: 'x' }, order: 0 }).success,
    ).toBe(false);
  });
});

describe('DecideEvaluationSchema', () => {
  it('requires a reason to reject', () => {
    expect(DecideEvaluationSchema.safeParse({ decision: 'rejected', version: 0 }).success).toBe(false);
    expect(
      DecideEvaluationSchema.safeParse({ decision: 'rejected', reason: 'failed medical', version: 0 }).success,
    ).toBe(true);
  });

  it('does not require a reason to approve', () => {
    expect(DecideEvaluationSchema.safeParse({ decision: 'approved', version: 2 }).success).toBe(true);
  });

  it('rejects unknown keys', () => {
    expect(
      DecideEvaluationSchema.safeParse({ decision: 'approved', version: 0, foo: 'bar' }).success,
    ).toBe(false);
  });
});
