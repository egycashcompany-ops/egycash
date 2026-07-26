// E.164 normalization for credential delivery (auth design §12 R3) — Egyptian local
// mobiles and already-international numbers must both resolve; garbage must not.
import { describe, expect, it } from 'vitest';
import { toE164 } from './whatsapp';

describe('toE164', () => {
  it('normalizes Egyptian local mobiles to +20', () => {
    expect(toE164('01012345678')).toBe('+201012345678');
    expect(toE164('010 1234 5678')).toBe('+201012345678');
    expect(toE164('010-1234-5678')).toBe('+201012345678');
  });

  it('keeps international formats', () => {
    expect(toE164('+201012345678')).toBe('+201012345678');
    expect(toE164('00201012345678')).toBe('+201012345678');
  });

  it('rejects garbage', () => {
    expect(toE164('')).toBeNull();
    expect(toE164('abc')).toBeNull();
    expect(toE164('123')).toBeNull();
  });
});
