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
//   │  │  │  │  │   └────── serial, where the uniqueness comes from
//   │  │  │  │  └────────── governorate code, must be a real one
//   │  └──┴──┴───────────── birth date, must be a real date in the past
//   └────────────────────── century: 2 = 1900s
//
// Only the serial moves. The date and governorate stay fixed and valid, so a failure in a fixture
// can never be a malformed date nobody meant to write.
//
// Each integration spec runs in its own process (`pool: 'forks'`) against its own database, so a
// module-level counter is per-file — which is exactly the scope uniqueness is needed at.

/** 1980-05-15, Cairo. Real date, real governorate, comfortably in the past. */
const PREFIX = '2800515' + '01';

let serial = 0;

/**
 * The next unique valid National ID for this spec file.
 *
 * 100,000 available per file — no suite is within three orders of magnitude of that, and the
 * throw below makes the ceiling loud rather than silently wrapping into duplicates.
 */
export const nextNationalId = (): string => {
  if (serial >= 100_000) {
    throw new Error('nextNationalId: serial space exhausted for this spec file');
  }
  const tail = String(serial).padStart(5, '0');
  serial += 1;
  return PREFIX + tail;
};
