import { describe, expect, it } from 'vitest';
import { formatOfferNumber, offerSequenceKey, parseOfferNumber } from './offer-number';

describe('formatOfferNumber', () => {
  it('pads the sequence to six digits (JO-{YYYY}-{seq:6})', () => {
    expect(formatOfferNumber(2026, 1)).toBe('JO-2026-000001');
    expect(formatOfferNumber(2026, 42)).toBe('JO-2026-000042');
    expect(formatOfferNumber(2026, 123456)).toBe('JO-2026-123456');
  });

  it('does not truncate a sequence beyond six digits', () => {
    expect(formatOfferNumber(2026, 1234567)).toBe('JO-2026-1234567');
  });
});

describe('offerSequenceKey', () => {
  it('is namespaced per year and distinct from the applicant counter', () => {
    expect(offerSequenceKey(2026)).toBe('jobOffer:2026');
    expect(offerSequenceKey(2027)).toBe('jobOffer:2027');
  });
});

describe('parseOfferNumber', () => {
  it('round-trips a formatted number', () => {
    expect(parseOfferNumber('JO-2026-000042')).toEqual({ year: 2026, seq: 42 });
  });

  it('rejects malformed / foreign codes', () => {
    expect(parseOfferNumber('APP-2026-000042')).toBeNull();
    expect(parseOfferNumber('JO-2026-42')).toBeNull();
    expect(parseOfferNumber('nonsense')).toBeNull();
  });
});
