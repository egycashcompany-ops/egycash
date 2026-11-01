// The paper fonts, promoted from Fleet (docs/12-planning/atm-settlements-phase1.md §8, §10.4): the
// Fleet path still yields the very same table, so a custody paper prints exactly as it did.
import { describe, expect, it } from 'vitest';
import * as fleet from '../../modules/fleet/lib/custody-paper-fonts';
import {
  PAPER_FACES,
  PAPER_FONT_CSS,
  PAPER_UNICODE_RANGE,
  STACK,
  measureText,
  paperFontsReady,
} from './paper-fonts';

describe('the fleet re-export', () => {
  it('yields the same PAPER_FONT_CSS, faces and stacks', () => {
    expect(fleet.PAPER_FONT_CSS).toBe(PAPER_FONT_CSS);
    expect(fleet.PAPER_FACES).toBe(PAPER_FACES);
    expect(fleet.STACK).toBe(STACK);
    expect(fleet.PAPER_UNICODE_RANGE).toBe(PAPER_UNICODE_RANGE);
  });

  it('shares one registration, not a second copy of its state', () => {
    expect(fleet.paperFontsReady).toBe(paperFontsReady);
    expect(fleet.measureText).toBe(measureText);
  });

  it('still writes one @font-face per face, limited to the Arabic blocks', () => {
    expect(PAPER_FONT_CSS.split('\n')).toHaveLength(PAPER_FACES.length);
    for (const rule of PAPER_FONT_CSS.split('\n')) {
      expect(rule).toMatch(/^@font-face\{font-family:"ECMS Paper [^"]+";src:local\(/u);
      expect(rule).toContain(`unicode-range:${PAPER_UNICODE_RANGE}`);
    }
    // Calibri's Arabic is Segoe UI, first after Calibri itself.
    expect(STACK.cal.startsWith('Calibri,"Segoe UI"')).toBe(true);
  });
});
