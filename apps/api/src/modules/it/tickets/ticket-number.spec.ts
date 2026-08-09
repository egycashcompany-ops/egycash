import { describe, expect, it } from 'vitest';
import { TICKET_CODE_MIN_DIGITS, formatTicketCode } from './ticket-number';
import { formatAssetCode } from '../assets/asset-number';

describe('formatTicketCode', () => {
  it('pads to the minimum width', () => {
    expect(formatTicketCode(1)).toBe('TKT-00001');
    expect(formatTicketCode(42)).toBe('TKT-00042');
  });

  it('grows past the width instead of truncating', () => {
    expect(formatTicketCode(123456)).toBe('TKT-123456');
  });

  it('keeps the documented width', () => {
    expect(TICKET_CODE_MIN_DIGITS).toBe(5);
  });

  // Both codes now come off the SAME counter collection (one `nextSequenceValue`, different keys).
  // The prefixes are what keep them apart, so a ticket and an asset holding sequence 7 must never
  // read as the same identifier on a label, in a search box, or in a report.
  it('never collides with an asset code at the same sequence', () => {
    for (const seq of [1, 42, 123456]) {
      expect(formatTicketCode(seq)).not.toBe(formatAssetCode(seq));
    }
  });
});
