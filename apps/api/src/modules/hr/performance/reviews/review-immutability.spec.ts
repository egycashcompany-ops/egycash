// D7 — a finalized review is a record, and records do not change.
//
// THE GUARD IS A WRITE CONDITION, NOT A CHECK, and this spec exists to keep it one. The difference
// is a race: a condition riding inside the same atomic `findOneAndUpdate` as the write cannot be
// overtaken by a request that read the row a moment before somebody finalized it, and a pre-check
// in a service can.
//
// It is also the difference between a rule that holds for every write and one that holds for the
// writes somebody remembered. `training-immutability.spec.ts` counts update paths because the
// training record has no such seam; here the seam IS the guard, so what has to be proved is that
// the seam is declared — and that no service reaches around it.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const FEATURE = resolve(HERE, '..');
const read = (file: string): string => readFileSync(resolve(FEATURE, file), 'utf8');
const strip = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const REPOSITORY = strip(read('performance.repository.ts'));

describe('the review repository refuses to write a closed row', () => {
  it('declares the condition', () => {
    expect(REPOSITORY).toContain('writeConditions()');
    expect(REPOSITORY).toContain("$nin: ['finalized', 'excused']");
  });

  /**
   * The condition and the explanation are a PAIR. Without `assertWritable`, a write that missed
   * because the row is closed is reported as a version conflict — and the caller is told to
   * refresh and try again, which will never work.
   */
  it('explains the refusal rather than reporting a stale version', () => {
    expect(REPOSITORY).toContain('assertWritable(');
    expect(REPOSITORY).toContain('BusinessRuleError');
  });

  /**
   * The condition is on the REVIEW repository and not on a shared base, so it must sit inside that
   * class. Asserted by slicing: a `writeConditions` declared on the cycle or the goal repository
   * would satisfy a whole-file `toContain` while leaving reviews unguarded.
   */
  it('declares it on the review repository, not somewhere else in the file', () => {
    const from = REPOSITORY.indexOf('class PerformanceReviewRepository');
    const to = REPOSITORY.indexOf('class PerformanceGoalRepository');
    expect(from).toBeGreaterThan(-1);
    expect(REPOSITORY.slice(from, to)).toContain('writeConditions()');
  });
});

/**
 * NOTHING REACHES AROUND THE SEAM.
 *
 * `updateById` and `softDeleteById` carry the condition; a raw `PerformanceReviewModel.updateOne`
 * or `findOneAndUpdate` in a service would not. The materializer's `openForEmployee` is the one
 * legitimate raw write in this feature — it INSERTS with `$setOnInsert` and can touch no existing
 * row — and it lives in the repository, where this scan does not reach.
 */
describe('no service writes a review outside the seam', () => {
  const services = (): { name: string; text: string }[] => {
    const out: { name: string; text: string }[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.service.ts')) {
          out.push({
            name: full.slice(FEATURE.length + 1),
            text: strip(readFileSync(full, 'utf8')),
          });
        }
      }
    };
    walk(FEATURE);
    return out;
  };

  it.each(services())('$name names no model directly', ({ text }) => {
    for (const forbidden of [
      'PerformanceReviewModel',
      'PerformanceCycleModel',
      'PerformanceGoalModel',
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });
});
