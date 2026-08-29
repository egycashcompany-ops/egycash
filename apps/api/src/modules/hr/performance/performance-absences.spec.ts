// D8–D13 — the six decisions to compute NOTHING, asserted.
//
// These are the spine of the performance design, and they are the half nothing else can hold. A
// rule that EXISTS is held by the code implementing it and the test exercising it; a rule that was
// deliberately not given has no code to point at, so the only way to keep it out is to say so here.
//
// Every one of the six names something a performance module is EXPECTED to have. Somebody adding a
// weighted average, a percentile band or a bonus flag would not be sabotaging anything — they would
// be filling in what looks like an obvious gap, in good faith, and inventing a business rule the
// owner has never given. §8 lists all five questions; until they are answered this file is what
// makes «not yet» mechanical rather than remembered.
//
// The characteristic failure of a performance module is arithmetic wearing the costume of
// judgement. It is worse than a wrong number, because a number attached to a person is BELIEVED —
// there is no bank statement to reconcile a 3.4 against, so nobody discovers it was never a
// judgement at all.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Every PRODUCTION source in the feature.
 *
 * SPECS ARE EXCLUDED, and not only this one. A test that asserts an absence has to NAME the thing
 * it forbids — the sentence «nothing here computes a distribution» contains the word it bans.
 * Scanning specs would make every guard trip every other guard, which is how a suite ends up with
 * allow-lists nobody can read. Nothing a spec contains reaches production.
 */
const sources = (): { name: string; text: string }[] => {
  const out: { name: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts') && !entry.includes('.spec.')) {
        out.push({ name: full.slice(HERE.length + 1), text: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(HERE);
  return out;
};

/** CODE ONLY — every file here explains in prose what it deliberately does not do. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const FILES = sources();

/**
 * Case-insensitive SUBSTRING, and the choice is the whole difference between a guard and a
 * decoration.
 *
 * The first version of this file used `\bbonus\b`, and a probe named `bonusFor` sailed through it:
 * camelCase puts a word character on both sides of the word being banned, so neither boundary
 * holds. `calculateBonus`, `bonusAmount` and `weightedRating` would all have passed a guard that
 * looked airtight — which is exactly the failure mode a decision-to-build-nothing cannot afford,
 * because nothing else would ever have noticed.
 *
 * A substring is safe HERE precisely because these words have no innocent use in this feature.
 * The two that DO — `mean` and `rank` sit inside ordinary English — keep a boundary below.
 */
const names = (text: string, forbidden: readonly string[]): void => {
  const source = code(text).toLowerCase();
  for (const word of forbidden) {
    expect(source, word).not.toContain(word);
  }
};

describe('the feature exists at all', () => {
  it('reads its own sources', () => {
    expect(FILES.length).toBeGreaterThan(4);
  });
});

/**
 * D8 / D9 — THE RATING IS STATED, NEVER COMPUTED.
 *
 * A weighted average of goal scores is the single most likely thing to appear here, because it
 * looks objective and takes ten lines. It is not objective: the weights are a business rule nobody
 * has given, it is trivially reverse-engineered by anybody being rated, and it cannot be defended
 * in the one conversation that matters — the one where somebody asks why they got a 3.
 *
 * The evaluator reads the goals and forms a judgement. That is what an evaluator is FOR.
 */
describe('D8/D9 — nothing computes a rating', () => {
  it.each(FILES)('$name carries no weighting', ({ text }) => {
    names(text, ['weight']);
  });

  /**
   * NOT a ban on arithmetic. Counting rows is arithmetic and the materializer's receipt is a
   * count. What is banned is arithmetic that PRODUCES A RATING — a mean, a sum of scores, a
   * normalisation — so the assertion names those and not the operators.
   */
  it.each(FILES)('$name derives no average or aggregate score', ({ text }) => {
    names(text, [
      'average',
      'normalize',
      'scoresum',
      'totalscore',
      'computedrating',
      // P3 — a goal's numbers, aggregated. A percentage is a rating wearing a different unit, and
      // «3 of 5 achieved» is the roll-up that ends up beside an assessment.
      'progresspercent',
      'completionrate',
      'goalscore',
      'achievementrate',
      'goalsachieved',
    ]);
    // `mean` keeps its boundaries: it is a word inside ordinary English identifiers, and banning
    // the substring would forbid anything named `meaning` or `means`.
    expect(code(text)).not.toMatch(/\bmean\b/i);
  });
});

/**
 * D10 — PERFORMANCE READS TRAINING AND ATTENDANCE AND WRITES TO NEITHER, and computes from neither.
 *
 * The review screen SHOWING what somebody was taught and how often they were present is right: an
 * evaluator should see it. Turning either into a number that moves the rating would be inventing
 * exactly the rule D8 refuses, and it would do it invisibly — «attendance-adjusted» is a word that
 * gets added to a tooltip, not to a decision log.
 *
 * The way a module accidentally settles a rule it was never given is by importing the collection
 * that stores the consequence.
 */
describe('D10 — nothing is derived from Attendance, and nothing is written to it', () => {
  it.each(FILES)('$name names no attendance model', ({ text }) => {
    const source = code(text);
    for (const forbidden of [
      'AttendanceDayModel',
      'AttendancePunchModel',
      'AttendanceRegularization',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it.each(FILES)('$name computes nothing from presence', ({ text }) => {
    names(text, [
      'absencerate',
      'absencecount',
      'presencescore',
      'latenessscore',
      'attendancescore',
    ]);
  });
});

/**
 * D9 — A GOAL'S OUTCOME IS STATED BY A PERSON, NEVER DERIVED.
 *
 * The derivation is one line — `current >= target ? 'achieved' : 'missed'` — and it is wrong in
 * both directions: a number reached for reasons nobody intended is not an achievement, and a
 * target missed because the work was cancelled is not a failure. The system holds both numbers
 * and has no way to tell those apart, which is exactly why it must not compare them.
 *
 * The same applies to the clock: nothing closes a goal because `dueAt` passed. A sweep that did
 * would be this module's first automatic judgement, arriving dressed as tidiness.
 */
describe('D9 — no goal outcome is computed', () => {
  it.each(FILES)('$name never compares current to target', ({ text }) => {
    const source = code(text);
    for (const forbidden of [
      /currentValue\s*[><=]=?\s*(doc\.|input\.|goal\.)?targetValue/,
      /targetValue\s*[><=]=?\s*(doc\.|input\.|goal\.)?currentValue/,
    ]) {
      expect(source, String(forbidden)).not.toMatch(forbidden);
    }
    names(text, ['outcomeof', 'isontrack', 'autoclose', 'autoachieve']);
  });

  it.each(FILES)('$name closes nothing on a date', ({ text }) => {
    // `dueAt` may be read and shown; what is banned is a comparison feeding a status change, and
    // the sweep verbs are how that arrives.
    names(text, ['overduesweep', 'expiregoals', 'closeexpired']);
  });
});

/**
 * D11 — NO CALIBRATION, NO FORCED DISTRIBUTION, NO RANKING.
 *
 * «The top 10% get X» is a real policy and an unstated one. A distribution computed anyway is not
 * a report — it is a list people are TREATED BY, produced by a rule the company never agreed to,
 * and by the time anybody notices, two rounds of decisions have been made on it.
 */
describe('D11 — nothing ranks anybody against anybody', () => {
  it.each(FILES)('$name computes no distribution', ({ text }) => {
    names(text, ['percentile', 'distribution', 'calibrat', 'forcedcurve', 'quota']);
  });

  /**
   * A ranking needs the reviews of a round sorted against each other. Nothing here sorts people by
   * their rating, so nothing here can produce a league table — `rank` is the word that would.
   */
  it.each(FILES)('$name ranks nobody', ({ text }) => {
    names(text, ['topperformer', 'bottomperformer', 'leaderboard']);
    // `rank` keeps a prefix boundary: it sits inside ordinary words, so the substring would be too
    // wide — but `rankOf`, `ranked` and `ranking` all start one, and all are caught.
    expect(code(text)).not.toMatch(/\brank/i);
  });
});

/**
 * D12 — NO PAY CONSEQUENCE.
 *
 * Whether and how a rating touches pay is the LARGEST unstated rule in this module, and it is §8's
 * first question. A bonus that follows a number is the most natural feature in the world to add and
 * the least defensible to have added without being asked — the money moves, and the only record of
 * why is a field somebody introduced on a Tuesday.
 */
describe('D12 — nothing here reaches Payroll', () => {
  it.each(FILES)('$name names no payroll model', ({ text }) => {
    const source = code(text);
    for (const forbidden of [
      'PayslipModel',
      'PayrollRunModel',
      'PayrollAdjustmentModel',
      'EmployeePayItemModel',
      'EmployeeCompensationModel',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it.each(FILES)('$name imports from neither payroll nor attendance', ({ text }) => {
    const source = code(text);
    expect(source).not.toMatch(/from '[^']*\/payroll[^']*'/);
    expect(source).not.toMatch(/from '[^']*\/attendance[^']*'/);
  });

  it.each(FILES)('$name carries no money and no entitlement', ({ text }) => {
    names(text, ['amountminor', 'bonus', 'increment', 'meritpay', 'payimpact', 'salary', 'raise']);
  });
});

/**
 * D13 — NO SELF-ASSESSMENT AND NO PEER REVIEW IN THIS PHASE.
 *
 * Both are real features, both are wanted eventually, and both change WHO MAY WRITE on a review —
 * which is the one thing D5 and D6 are built around. Adding either now would mean designing the
 * permission model twice and discovering the second design in production.
 */
describe('D13 — one evaluator writes a review, and it is not the subject', () => {
  it.each(FILES)('$name has no self or peer assessment', ({ text }) => {
    names(text, [
      'selfassessment',
      'selfrating',
      'selfscore',
      'peerreview',
      'peerrating',
      'threesixty',
    ]);
  });
});
