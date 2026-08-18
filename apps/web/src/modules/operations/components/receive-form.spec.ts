// Seal parsing for the vault receive form.
//
// Seals arrive from a barcode scanner or a paste, which means trailing separators and stray blank
// lines are normal input, not user error. An empty string reaching the server would be a seal that
// does not exist — the contract requires each entry to be non-empty, so the form must not send one.
import { describe, expect, it } from 'vitest';
import { parseSeals } from './ReceiveIntoVaultDialog';

describe('parseSeals', () => {
  it('splits on newlines — what a scanner produces', () => {
    expect(parseSeals('S1\nS2\nS3')).toEqual(['S1', 'S2', 'S3']);
  });

  it('splits on commas too — what a paste often looks like', () => {
    expect(parseSeals('S1, S2,S3')).toEqual(['S1', 'S2', 'S3']);
  });

  it('drops blanks so a trailing separator cannot invent an empty seal', () => {
    expect(parseSeals('S1,,\n  \nS2,')).toEqual(['S1', 'S2']);
  });

  it('is an empty list for empty input, never a list holding one empty string', () => {
    expect(parseSeals('')).toEqual([]);
    expect(parseSeals('   \n  ')).toEqual([]);
  });

  it('trims each entry', () => {
    expect(parseSeals('  S1  ,  S2 ')).toEqual(['S1', 'S2']);
  });
});
