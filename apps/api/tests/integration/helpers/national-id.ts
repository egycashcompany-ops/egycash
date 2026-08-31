// Unique, structurally valid Egyptian National IDs for integration fixtures.
//
// WHY THIS EXISTS. Registration requires a National ID, and `applicant.service.ts` rejects a
// second LIVE applicant carrying one that is already in use (`ConflictError`). So a fixture
// cannot share a constant: every registration in a suite needs its own number, the same way
// every registration already needs its own phone via each file's `nextPhone()` counter. This is
// that counter, for the other unique field.
//
// The shape is the parser's own, not a guess at it (`parseNationalId`, contracts/value-objects):
//
//   2 YY MM DD GG SSS G C
//   │  │  │  │  │   │  │ └─ check position — unused by the parser, free
//   │  │  │  │  │   │  └─── gender digit: odd = male, even = female
//   │  │  │  │  │   └────── serial
//   │  │  │  │  └────────── governorate code, must be a real one
//   │  └──┴──┴───────────── birth date, must be a real date in the past
//   └────────────────────── century: 2 = 1900s
//
// WHY THE BIRTH DATE MOVES TOO, and not just the serial. A National ID is not only unique — it
// DERIVES the applicant's birth date, and duplicate detection (`applicant.repository.ts`,
// `findDuplicateCandidates`) matches on `{ searchName, birthDate }` whenever a birth date is
// known. Fixtures reuse one Arabic name across a file, so a constant date here would make every
// applicant in that file the "same person" as the last one: each registration would flag a
// duplicate it never meant to create. That is a real failure mode, not a cosmetic one — it was
// what turned this suite red once already. Moving the date keeps two fixture candidates two
// different people, so a duplicate flag in a test means the test asked for one.
//
// Governorate stays fixed and the date stays comfortably in the past, so a failure in a fixture
// can never be a malformed date nobody meant to write.
//
// Each integration spec runs in its own process (`pool: 'forks'`) against its own database, so a
// module-level counter is per-file — which is exactly the scope uniqueness is needed at.

/** Cairo. Real governorate, and the same one for every fixture. */
const GOVERNORATE = '01';

let serial = 0;

/**
 * The next unique valid National ID for this spec file, with a birth date of its own.
 *
 * 100,000 available per file — no suite is within three orders of magnitude of that, and the
 * throw below makes the ceiling loud rather than silently wrapping into duplicates.
 */
export const nextNationalId = (): string => {
  if (serial >= 100_000) {
    throw new Error('nextNationalId: serial space exhausted for this spec file');
  }
  const n = serial;
  serial += 1;
  // Day 1-28 so every day is valid in every month; the three cycle at different rates, so the
  // date is distinct for the first 6,720 calls and only then repeats — far past any suite's need.
  const day = (n % 28) + 1;
  const month = (Math.floor(n / 28) % 12) + 1;
  const year = 1980 + (Math.floor(n / 336) % 20);
  const yy = String(year % 100).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `2${yy}${mm}${dd}${GOVERNORATE}${String(n).padStart(5, '0')}`;
};
