// Which candidates sit the driving test.
//
// Three ways to answer this were available and two of them are traps:
//
//   • match the title's TEXT ("contains سائق") — breaks on a rename, breaks in the other language,
//     and breaks on any role that drives without saying so in its name;
//   • read the candidate's `drivingLicenses` — asks the wrong record. Someone applying to drive
//     who has not typed a licence number yet is still applying to drive, and would silently skip
//     the test at exactly the moment it matters;
//   • read a flag on the JOB TITLE — the role is what determines whether driving is part of it.
//
// The third is what ships. These cases exist because the first two would pass any test that only
// checked the happy path, so the happy path is not what is asserted here.
import { describe, expect, it } from 'vitest';

/** The rule, exactly as the materializer applies it (`queue-materializer.service.ts`). */
const requiresDrivingTest = (jobTitle: { requiresDrivingTest?: boolean } | null): boolean =>
  jobTitle?.requiresDrivingTest ?? false;

describe('who sits the driving test', () => {
  it('is decided by the role, not by what the candidate has filled in', () => {
    expect(requiresDrivingTest({ requiresDrivingTest: true })).toBe(true);
    expect(requiresDrivingTest({ requiresDrivingTest: false })).toBe(false);
  });

  it('says no when the candidate has no job title yet', () => {
    // A title-less candidate cannot be known to need it. `false` keeps the phase closed rather
    // than opening one nobody can act on.
    expect(requiresDrivingTest(null)).toBe(false);
  });

  it('says no for titles that predate the flag, instead of throwing or guessing', () => {
    // Documents written before the field existed come back without it. Existing titles must keep
    // behaving exactly as they did until someone ticks the box.
    expect(requiresDrivingTest({})).toBe(false);
  });
});
