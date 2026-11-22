// The bulk photo upload's rules (pure): which employee each file is for, and what will happen to it.
//
// «عندى صور الموظفين كلهم عايز أرفعهم دفع واحده متسمى كل صورة بالكود + أسم الموظف (الكود صحيح أكيد لكن
// الأسماء ممكن يبقي فيها حروف متلغبطه أو مسافات)». So THE CODE DECIDES, and only the code: it is read
// out of the file's name and matched exactly against the employees' codes. The name in the file is
// never used to choose anybody. It is only compared with the matched employee's name, and a file
// whose name looks like somebody else's is flagged for a look — never refused, never re-matched.
//
// «غير كله باللى هبعته جديد»: a matched employee's current photo is replaced.
import {
  EMPLOYEE_PHOTO_MIME_TYPES,
  foldOrgUnitName,
  type EmployeeCodeMatchDto,
} from '@ecms/contracts';

/** Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits as ASCII — a name typed in Arabic. */
export const asciiDigits = (value: string): string =>
  value
    .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x06f0));

/** The shortest employee code (`EMPLOYEE_CODE_PATTERN`: a 3-digit branch prefix and 4+ digits). */
export const EMPLOYEE_CODE_MIN_DIGITS = 7;
/** The shortest run of digits given back its dropped zeros: a code that lost one or two of them. */
export const PADDED_FROM_DIGITS = EMPLOYEE_CODE_MIN_DIGITS - 2;
/**
 * The longest any code can be (`EXTERNAL_EMPLOYEE_CODE_PATTERN`: 20 characters; an employee's is at
 * most 12 digits). A longer run of digits — a scanner's time stamp — can be nobody's code, and
 * asking about it would only make the server refuse the whole question.
 */
export const LONGEST_CODE = 20;

export interface ParsedPhotoName {
  /** The name without its extension, Arabic digits read as ASCII. */
  stem: string;
  /** The codes the name could mean, most likely first. */
  candidates: string[];
  /** The candidates made by putting back zeros a spreadsheet dropped (`101469` → `0101469`). */
  padded: string[];
  /** What is left once the likeliest code is taken out: the employee's name, as typed. */
  nameInFile: string;
}

/**
 * The words that could be an external person's code (`EX-2900`): each run of ASCII letters and
 * digits joined by dashes (`EX-2900-Ahmed`), and every part of it between dashes (`EX-2900`), that
 * holds a letter and a digit and is no longer than a code. Longest first.
 */
const codeWords = (stem: string): string[] => {
  const out: string[] = [];
  for (const match of stem.matchAll(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/gu)) {
    const parts = match[0].split('-');
    for (let from = 0; from < parts.length; from += 1) {
      for (let to = parts.length; to > from; to -= 1) {
        const word = parts.slice(from, to).join('-');
        const fits = word.length >= 2 && word.length <= LONGEST_CODE;
        if (fits && /[A-Za-z]/u.test(word) && /\d/u.test(word) && !out.includes(word))
          out.push(word);
      }
    }
  }
  return out.sort((a, b) => b.length - a.length);
};

/**
 * The name beside the code: the file's name without `code` (as it is written there), without any
 * other digits, and with separators as spaces.
 */
export const nameBeside = (stem: string, code: string | null): string =>
  (code === null ? stem : stem.replace(code, ' '))
    .replace(/\d+/gu, ' ')
    .replace(/[_\-.+()[\]{}#،,]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

/**
 * Read a file's name: the codes it could carry and the name beside them.
 *
 * Every run of digits is a candidate, longest first — the employee's code is the long number in the
 * name. A run one or two digits SHORTER than a code is also tried with the zeros a spreadsheet drops
 * in front of it (`101469` → `0101469`), because no code is that short, so the padded one is the
 * only thing it can mean — unless the name already holds a full-length number; a shorter run (a
 * copy's «(2)») is not padded, and a run longer than any code (a time stamp) is not tried.
 *
 * The order only says which code to show for a file nobody holds: the plan never takes the first
 * match on trust — a name whose codes match two different people is held (`ambiguous`). A word of letters and digits (an external person's `EX-2900`) is
 * tried just BEFORE the digits inside it — more exact than they are, and never ahead of a longer
 * number elsewhere in the name, so a stray `C2` cannot beat the employee's code.
 */
export const parsePhotoName = (fileName: string): ParsedPhotoName => {
  const stem = asciiDigits(fileName.replace(/\.[^./\\]+$/u, '')).trim();
  const runs = [...stem.matchAll(/\d+/gu)]
    .map((m) => m[0])
    .filter((run) => run.length <= LONGEST_CODE);
  const words = codeWords(stem);
  const candidates: string[] = [];
  const padded: string[] = [];
  const add = (code: string): void => {
    if (code !== '' && !candidates.includes(code)) candidates.push(code);
  };
  // A name that holds a full-length number already has its code (or a camera's date): nothing in it
  // lost its zeros, so no short run is padded — `20231105_101845` is no `0101845`.
  const hasFullRun = runs.some((run) => run.length >= EMPLOYEE_CODE_MIN_DIGITS);
  for (const run of [...runs].sort((a, b) => b.length - a.length)) {
    for (const word of words) if (word.includes(run)) add(word);
    add(run);
    if (!hasFullRun && run.length >= PADDED_FROM_DIGITS && run.length < EMPLOYEE_CODE_MIN_DIGITS) {
      const full = run.padStart(EMPLOYEE_CODE_MIN_DIGITS, '0');
      if (!candidates.includes(full)) padded.push(full);
      add(full);
    }
  }
  return { stem, candidates, padded, nameInFile: nameBeside(stem, candidates[0] ?? null) };
};

// ---------------------------------------------------------------------------------------------
// The name, as a check only

const squeeze = (name: string): string => foldOrgUnitName(name).replace(/\s+/gu, '');

/** Edits (insert, delete, change) from `a` to `b`. */
export const editDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
};

/**
 * How alike the name in the file is to the employee's name, from 0 to 1, after folding the letters
 * people mix up (أ إ آ ا, ى ي, ة ه, tashkeel) and dropping every space. A file usually carries the
 * first two or three names, so it is compared with the START of the full name, as long as itself,
 * as well as with the whole of it; the better of the two counts.
 */
export const nameLikeness = (nameInFile: string, employeeName: string): number => {
  const file = squeeze(nameInFile);
  const full = squeeze(employeeName);
  if (file === '' || full === '') return 1;
  const score = (other: string): number =>
    1 - editDistance(file, other) / Math.max(file.length, other.length);
  return Math.max(score(full), score(full.slice(0, file.length)));
};

/** Below this, the name in the file does not look like the matched employee's: worth a look. */
export const NAME_LIKENESS_FLOOR = 0.6;

// ---------------------------------------------------------------------------------------------
// The plan

export type PhotoRowStatus =
  /** Matched one employee; will be uploaded (replacing a photo when there is one). */
  | 'ready'
  /** No digits in the name: nothing to match by. */
  | 'noCode'
  /** No employee within reach holds the code. */
  | 'unknownCode'
  /** Another included file is for the same employee: untick all but one. */
  | 'duplicate'
  /** Not a JPEG, PNG or WebP picture. */
  | 'unsupported'
  /** Left out by the person. */
  | 'excluded'
  /** The name holds codes of two or more different people: it is held, never guessed. Rename it. */
  | 'ambiguous'
  /**
   * Matched only once zeros were put back in front of the code, and the name in the file does not
   * back it (none, or not the employee's): too weak to replace a photo on. Rename it with the code.
   */
  | 'unconfirmed'
  /**
   * The employee's photo already went up recently (`PlanOptions.skipSince`): not sent again, so a
   * second pick of the same folder — after a reload, the next day — sends only what is missing.
   */
  | 'recent';

export interface PhotoFileInput {
  /** Unique within the batch: the same file, however it was picked, has the same key. */
  key: string;
  name: string;
  type: string;
}

export interface PhotoRow {
  key: string;
  name: string;
  status: PhotoRowStatus;
  /** The code the file was matched by (or the first it carried, when none matched). */
  code: string | null;
  /** The code was completed with the zeros dropped in front of it. */
  padded: boolean;
  nameInFile: string;
  employee: EmployeeCodeMatchDto | null;
  /** The name in the file does not look like the employee's (`NAME_LIKENESS_FLOOR`). */
  nameDiffers: boolean;
  /** Every code in the name that someone holds, when they are different people (`ambiguous`). */
  rivalCodes: string[];
}

const PHOTO_TYPES: readonly string[] = EMPLOYEE_PHOTO_MIME_TYPES;

/** Every code any of the files could carry — what to ask the server about. */
export const codesToLookUp = (files: readonly PhotoFileInput[]): string[] => [
  ...new Set(files.flatMap((file) => parsePhotoName(file.name).candidates)),
];

export interface PlanOptions {
  /**
   * Skip the employees whose current photo was uploaded at or after this time (ms since epoch):
   * «مش عايز أرفع اللى اترفعوا». Null sends everyone again.
   */
  skipSince?: number | null;
}

/** Was this employee's current photo uploaded at or after `since`? */
export const photoIsRecent = (employee: EmployeeCodeMatchDto, since: number | null): boolean => {
  if (since === null || employee.photoUploadedAt === null) return false;
  const at = Date.parse(employee.photoUploadedAt);
  return Number.isFinite(at) && at >= since;
};

/**
 * Each file's row, on its own: matched by code, then checked. `excluded` holds the keys the person
 * unticked. Duplicates are marked after, by `markDuplicates` — `planPhotoBatch` does both.
 */
export const planFiles = (
  files: readonly PhotoFileInput[],
  matches: ReadonlyMap<string, EmployeeCodeMatchDto>,
  excluded: ReadonlySet<string>,
  { skipSince = null }: PlanOptions = {},
): PhotoRow[] =>
  files.map((file) => {
    const parsed = parsePhotoName(file.name);
    // Every code in the name that someone holds. One person: that is the match. Two or more
    // different people: the file is held — the wrong one would lose their photo to it.
    const held = parsed.candidates.filter((code) => matches.has(code));
    const people = new Set(held.map((code) => matches.get(code)?.id));
    const rivals = people.size > 1 ? held : [];
    const hit = rivals.length > 0 ? null : (held[0] ?? null);
    const employee = hit === null ? null : (matches.get(hit) ?? null);
    // The name beside the code that MATCHED, not beside the likeliest one.
    const nameInFile = hit === null ? parsed.nameInFile : nameBeside(parsed.stem, hit);
    const padded = hit !== null && parsed.padded.includes(hit);
    // Against each name the employee HAS: a missing English name is no name, not a match.
    const nameDiffers =
      employee !== null &&
      Math.max(
        ...[employee.fullNameAr, employee.fullNameEn ?? '']
          .filter((name) => name.trim() !== '')
          .map((name) => nameLikeness(nameInFile, name)),
        0,
      ) < NAME_LIKENESS_FLOOR;
    const status: PhotoRowStatus = excluded.has(file.key)
      ? 'excluded'
      : !PHOTO_TYPES.includes(file.type)
        ? 'unsupported'
        : parsed.candidates.length === 0
          ? 'noCode'
          : rivals.length > 0
            ? 'ambiguous'
            : employee === null
              ? 'unknownCode'
              : padded && (nameInFile === '' || nameDiffers)
                ? 'unconfirmed'
                : photoIsRecent(employee, skipSince)
                  ? 'recent'
                  : 'ready';
    return {
      key: file.key,
      name: file.name,
      status,
      code: hit ?? parsed.candidates[0] ?? null,
      padded,
      nameInFile,
      employee,
      nameDiffers,
      rivalCodes: rivals,
    };
  });

/**
 * Two included files for one employee: both are marked, until all but one are left out. A file
 * already uploaded in this run (`settled`) competes with nothing — a corrected photo picked after
 * it is simply the next one sent, and replaces it. Rows that are not marked are returned as they
 * were, so a memoized row is not drawn again.
 */
export const markDuplicates = (
  rows: readonly PhotoRow[],
  settled: ReadonlySet<string> = new Set(),
): PhotoRow[] => {
  const perEmployee = new Map<string, number>();
  const competes = (row: PhotoRow): boolean =>
    row.status === 'ready' && row.employee !== null && !settled.has(row.key);
  for (const row of rows) {
    if (competes(row) && row.employee !== null) {
      perEmployee.set(row.employee.id, (perEmployee.get(row.employee.id) ?? 0) + 1);
    }
  }
  return rows.map((row) =>
    competes(row) && row.employee !== null && (perEmployee.get(row.employee.id) ?? 0) > 1
      ? { ...row, status: 'duplicate' }
      : row,
  );
};

/** Each file's row, duplicates marked: `planFiles` then `markDuplicates`. */
export const planPhotoBatch = (
  files: readonly PhotoFileInput[],
  matches: ReadonlyMap<string, EmployeeCodeMatchDto>,
  excluded: ReadonlySet<string>,
  settled: ReadonlySet<string> = new Set(),
  options: PlanOptions = {},
): PhotoRow[] => markDuplicates(planFiles(files, matches, excluded, options), settled);

/** What is known of a file beyond its name, to choose between two photos of one person. */
export interface PhotoFileFacts {
  size: number;
  lastModified: number;
}

/** How well the name in the file fits the employee: the better of their two names. */
const fitOf = (row: PhotoRow): number =>
  row.employee === null
    ? 0
    : Math.max(
        ...[row.employee.fullNameAr, row.employee.fullNameEn ?? '']
          .filter((name) => name.trim() !== '')
          .map((name) => nameLikeness(row.nameInFile, name)),
        0,
      );

/**
 * One photo of each employee who has several: «المكرر تختار منه أنت تلقائي واحده». The one kept
 * is the one whose name in the file fits the employee best; then the newest file (the later
 * shot); then the largest (the sharper copy); then the name, so the choice never depends on the
 * order the files came in. Only rows marked `duplicate` take part. Returns the keys to leave out.
 */
export const pickOnePerEmployee = (
  rows: readonly PhotoRow[],
  factsOf: (key: string) => PhotoFileFacts | undefined,
): { keep: Set<string>; leave: Set<string> } => {
  const groups = new Map<string, PhotoRow[]>();
  for (const row of rows) {
    if (row.status !== 'duplicate' || row.employee === null) continue;
    groups.set(row.employee.id, [...(groups.get(row.employee.id) ?? []), row]);
  }
  const keep = new Set<string>();
  const leave = new Set<string>();
  for (const group of groups.values()) {
    const ranked = [...group].sort((a, b) => {
      const fit = fitOf(b) - fitOf(a);
      if (fit !== 0) return fit;
      const newer = (factsOf(b.key)?.lastModified ?? 0) - (factsOf(a.key)?.lastModified ?? 0);
      if (newer !== 0) return newer;
      const larger = (factsOf(b.key)?.size ?? 0) - (factsOf(a.key)?.size ?? 0);
      if (larger !== 0) return larger;
      return a.name.localeCompare(b.name);
    });
    const [best, ...rest] = ranked;
    if (best !== undefined) keep.add(best.key);
    for (const row of rest) leave.add(row.key);
  }
  return { keep, leave };
};

/** How many rows are in each state — the summary over the table. */
export const countByStatus = (rows: readonly PhotoRow[]): Record<PhotoRowStatus, number> => {
  const counts: Record<PhotoRowStatus, number> = {
    ready: 0,
    noCode: 0,
    unknownCode: 0,
    duplicate: 0,
    unsupported: 0,
    excluded: 0,
    ambiguous: 0,
    unconfirmed: 0,
    recent: 0,
  };
  for (const row of rows) counts[row.status] += 1;
  return counts;
};
