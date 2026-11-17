// «فى الـ IT تحديداً فى تسليم العهدة عايزك تسمح عادى بالتسليم حتى لو مطبعش إيصال» — the hand-over
// records without a print, and a printed paper's number rides it only while the paper still says
// what is recorded.
import { describe, expect, it } from 'vitest';
import { canHandOver, handOverPaper } from './hand-over-paper';

const request = JSON.stringify({ employeeId: 'e-1', lines: [{ assetId: 'a-1' }] });
const edited = JSON.stringify({
  employeeId: 'e-1',
  lines: [{ assetId: 'a-1' }, { assetId: 'a-2' }],
});

describe('handOverPaper', () => {
  it('nothing printed: the hand-over goes ahead, and the server numbers its receipt', () => {
    expect(handOverPaper(null, request, null)).toEqual({ state: 'optional', formNumber: null });
  });

  it('printed for exactly this request: the hand-over records that paper’s number', () => {
    expect(handOverPaper(request, request, 41)).toEqual({ state: 'printed', formNumber: 41 });
  });

  it('printed, then changed: the stale paper’s number is never sent', () => {
    expect(handOverPaper(request, edited, 41)).toEqual({ state: 'stale', formNumber: null });
  });

  it('printed again after the change: the new paper counts', () => {
    expect(handOverPaper(edited, edited, 42)).toEqual({ state: 'printed', formNumber: 42 });
  });
});

describe('canHandOver', () => {
  it('needs no print — only a complete form', () => {
    expect(canHandOver(true, false)).toBe(true);
    expect(canHandOver(false, false)).toBe(false);
  });

  it('waits while a paper is being composed, which may yet be the one to record', () => {
    expect(canHandOver(true, true)).toBe(false);
  });
});
