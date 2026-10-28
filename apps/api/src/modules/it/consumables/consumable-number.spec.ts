// The consumables' two series: an item's code «CON-00001», and a memo's printed number
// «EGYCASH-IT-CON-0001» — each its own key in the module's one counter.
import { describe, expect, it } from 'vitest';
import { formatConsumableMemoNumber } from '@ecms/contracts';
import {
  CONSUMABLE_MEMO_SEQUENCE_KEY,
  CONSUMABLE_SEQUENCE_KEY,
  formatConsumableCode,
} from './consumable-number';

describe('the consumables’ series', () => {
  it('codes an item «CON-00001», growing wider rather than truncating', () => {
    expect(formatConsumableCode(1)).toBe('CON-00001');
    expect(formatConsumableCode(123456)).toBe('CON-123456');
  });

  it('prints a memo on the paper’s own series', () => {
    expect(formatConsumableMemoNumber(1)).toBe('EGYCASH-IT-CON-0001');
    expect(formatConsumableMemoNumber(12345)).toBe('EGYCASH-IT-CON-12345');
  });

  it('keeps the two apart from each other and from every other IT series', () => {
    expect(CONSUMABLE_SEQUENCE_KEY).toBe('consumable:global');
    expect(CONSUMABLE_MEMO_SEQUENCE_KEY).toBe('consumableMemo:global');
    expect([CONSUMABLE_SEQUENCE_KEY, CONSUMABLE_MEMO_SEQUENCE_KEY]).not.toContain(
      'custodyReceipt:global',
    );
  });
});
