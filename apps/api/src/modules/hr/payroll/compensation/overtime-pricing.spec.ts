// Overtime pricing works, and carries no premium (P-HR-09).
//
// This phase built nothing, because the seam was already complete: an approved minute crosses the
// §15.1 feed as a QUANTITY and a `perMinute` pay item prices it at its own rate. What was missing —
// and still is — is a multiplier, which is a legal rule nobody has given. See
// docs/12-planning/overtime-pricing.md §2.
//
// So this file is a guard rather than a feature. It holds two things that would otherwise drift
// apart silently:
//
//   • the PATH stays wired. Overtime pricing is assembled from five files that never import each
//     other directly — the feed, the port, the mapper, the vocabulary and the engine — so any one
//     of them can stop agreeing with the others without a type error anywhere.
//   • the ABSENCE stays an absence. A factor is one edit away in half a dozen places, and the only
//     thing that makes "we did not decide this yet" survive contact with a deadline is a test that
//     fails when somebody decides it quietly.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PAY_ITEM_CALC_BASES,
  PAY_ITEM_QUANTITY_SOURCES,
  QUANTITY_SOURCE_UNITS,
} from '@ecms/contracts';

const HERE = dirname(fileURLToPath(import.meta.url));
const HR = resolve(HERE, '../..');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.ts') && !entry.name.includes('.spec.') ? [full] : [];
  });

/** Code only — every file here explains the absence in prose, and prose must not prove it. */
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

describe('an approved overtime minute can be priced today', () => {
  it('is a declared quantity source, counted in minutes', () => {
    expect([...PAY_ITEM_QUANTITY_SOURCES]).toContain('approvedOvertimeMinutes');
    expect(QUANTITY_SOURCE_UNITS.approvedOvertimeMinutes).toBe('minutes');
    expect([...PAY_ITEM_CALC_BASES]).toContain('perMinute');
  });

  it('and the mapper reads it off the frozen feed row', () => {
    const quantities = code(resolve(HERE, 'attendance-quantities.ts'));
    expect(quantities).toContain('approvedOvertimeMinutes: (row) => row.approvedOvertimeMinutes');
  });

  /**
   * The engine's half: rate × quantity, and NO proration factor.
   *
   * The second part is the subtle one and it is load-bearing. The quantity was already counted over
   * the employee's slice of the period, so scaling it again by `daysInForce / daysInPeriod` would
   * charge the same absence twice. A factor appearing on this branch is a real defect, not a style
   * change, which is why it is pinned here rather than left to the engine's own spec.
   */
  it('and the engine multiplies the rate by the quantity, without prorating it again', () => {
    const rules = code(resolve(HERE, 'compensation-rules.ts'));
    expect(rules).toContain("assignment.item.calcBasis === 'perMinute'");
    expect(rules).toContain('quantityFor(attendance.rows, source, slice, spans)');
    expect(rules).toContain('scaleMinorUnits(toMinorUnits(assignment.amount), quantity)');
  });

  // Unknown, never zero: an item that cannot be priced is shown and excluded from every total,
  // because a total containing a guess is worse than no total (PY-4 / D2).
  it('and refuses to guess when the source or the feed is missing', () => {
    const rules = code(resolve(HERE, 'compensation-rules.ts'));
    expect(rules).toContain('source === null || attendance === null');
    expect(rules).toContain('COMPENSATION_LINE_STATES[1]');
  });
});

describe('and it carries no premium, because nobody has given one', () => {
  /**
   * THE ABSENCE, held across the whole HR module rather than one file.
   *
   * Egyptian labour law has overtime factors. This repository does not, and a number typed into any
   * of these files would be somebody's guess wearing the authority of code. The blocker and the
   * three decisions that would lift it are in docs/12-planning/overtime-pricing.md §2.
   */
  it('no multiplier, premium or factor exists anywhere in HR', () => {
    const offenders: string[] = [];
    for (const file of sources(HR)) {
      const source = code(file).toLowerCase();
      for (const word of ['multiplier', 'premiumrate', 'overtimefactor', 'overtimerate']) {
        if (source.includes(word)) offenders.push(`${file.slice(HR.length + 1)}: ${word}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // …and the two shapes a factor would most plausibly take, named so neither arrives quietly.
  it('and the engine holds no rate constant of its own', () => {
    const rules = code(resolve(HERE, 'compensation-rules.ts'));
    for (const literal of ['1.5', '2.0', '* 1.5', '* 2']) {
      expect(rules, literal).not.toContain(literal);
    }
  });
});
