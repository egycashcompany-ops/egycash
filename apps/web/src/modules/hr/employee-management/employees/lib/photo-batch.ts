// The bulk photo upload's rules (pure): which employee each file is for, and what will happen to it.
//
// «عندى صور الموظفين كلهم عايز أرفعهم دفع واحده متسمى كل صورة بالكود + أسم الموظف (الكود صحيح أكيد لكن
// الأسماء ممكن يبقي فيها حروف متلغبطه أو مسافات)». So THE CODE DECIDES, and only the code: it is read
// out of the file's name and matched exactly against the employees' codes. The name in the file is
// never used to choose anybody. It is only compared with the matched employee's name, and a file
// whose name looks like somebody else's is flagged for a look — never refused, never re-matched.
//
// «غير كله باللى هبعته جديد»: a matched employee's current photo is replaced.
import { EMPLOYEE_PHOTO_MIME_TYPES, foldOrgUnitName, type EmployeeCodeMatchDto } from '@ecms/contracts';

/** Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits as ASCII — a name typed in Arabic. */
export const asciiDigits = (value: string): string =>
  value
    .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x06f0));

/** The shortest employee code (`EMPLOYEE_CODE_PATTERN`: a 3-digit branch prefix and 4+ digits). */
export const EMPLOYEE_CODE_MIN_DIGITS = 7;

export interface ParsedPhotoName {
  /** The codes the name could mean, most likely first. */
  candidates: string[];
  /** The candidates made by putting back zeros a spreadsheet dropped (`101469` → `0101469`). */
  padded: string[];
  /** What is left of the name once the code is taken out: the employee's name, as typed. */
  nameInFile: string;
}

/**
 * Read a file's name: the codes it could carry and the name beside them.
 *
 * Every run of digits is a candidate, longest first. A run SHORTER than a code is also tried with
 * the zeros a spreadsheet drops in front of it (`101469` → `0101469`), because no code is that
 * short, so the padded one is the only thing it can mean. A whole word of letters, digits and
 * dashes is a candidate too, for the external people's codes.
 */
export const parsePhotoName = (fileName: string): ParsedPhotoName => {
  const stem = asciiDigits(fileName.replace(/\.[^./\\]+$/u, '')).trim();
  const runs = [...stem.matchAll(/\d+/gu)].map((m) => m[0]);
  const candidates: string[] = [];
  const padded: string[] = [];
  const add = (code: string): void => {
    if (code !== '' && !candidates.includes(code)) candidates.push(code);
  };
  for (const run of [...runs].sort((a, b) => b.length - a.length)) {
    add(run);
    if (run.length < EMPLOYEE_CODE_MIN_DIGITS) {
      const full = run.padStart(EMPLOYEE_CODE_MIN_DIGITS, '0');
      if (!candidates.includes(full)) padded.push(full);
      add(full);
    }
  }
  for (const word of stem.split(/[\s_+]+/u)) {
    if (/^[A-Za-z0-9-]{2,20}$/u.test(word) && /\d/u.test(word)) add(word);
  }
  const nameInFile = stem
    .replace(/[A-Za-z]*\d[A-Za-z0-9-]*/gu, ' ')
    .replace(/[_\-.+()[\]{}#،,]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return { candidates, padded, nameInFile };
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
  | 'excluded';

export interface PhotoFileInput {
  /** Unique within the batch (the path when a folder was picked, else the name and size). */
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
}

const PHOTO_TYPES: readonly string[] = EMPLOYEE_PHOTO_MIME_TYPES;

/** Every code any of the files could carry — what to ask the server about. */
export const codesToLookUp = (files: readonly PhotoFileInput[]): string[] => [
  ...new Set(files.flatMap((file) => parsePhotoName(file.name).candidates)),
];

/**
 * Each file's row: matched by code, then checked. `excluded` holds the keys the person unticked;
 * duplicates are counted among the files still included, so unticking all but one clears them.
 */
export const planPhotoBatch = (
  files: readonly PhotoFileInput[],
  matches: ReadonlyMap<string, EmployeeCodeMatchDto>,
  excluded: ReadonlySet<string>,
): PhotoRow[] => {
  const rows: PhotoRow[] = files.map((file) => {
    const parsed = parsePhotoName(file.name);
    const hit = parsed.candidates.find((code) => matches.has(code)) ?? null;
    const employee = hit === null ? null : (matches.get(hit) ?? null);
    const status: PhotoRowStatus = excluded.has(file.key)
      ? 'excluded'
      : !PHOTO_TYPES.includes(file.type)
        ? 'unsupported'
        : parsed.candidates.length === 0
          ? 'noCode'
          : employee === null
            ? 'unknownCode'
            : 'ready';
    return {
      key: file.key,
      name: file.name,
      status,
      code: hit ?? parsed.candidates[0] ?? null,
      padded: hit !== null && parsed.padded.includes(hit),
      nameInFile: parsed.nameInFile,
      employee,
      // Against each name the employee HAS: a missing English name is no name, not a match.
      nameDiffers:
        employee !== null &&
        Math.max(
          ...[employee.fullNameAr, employee.fullNameEn ?? '']
            .filter((name) => name.trim() !== '')
            .map((name) => nameLikeness(parsed.nameInFile, name)),
          0,
        ) < NAME_LIKENESS_FLOOR,
    };
  });
  const perEmployee = new Map<string, number>();
  for (const row of rows) {
    if (row.status === 'ready' && row.employee !== null) {
      perEmployee.set(row.employee.id, (perEmployee.get(row.employee.id) ?? 0) + 1);
    }
  }
  return rows.map((row) =>
    row.status === 'ready' && row.employee !== null && (perEmployee.get(row.employee.id) ?? 0) > 1
      ? { ...row, status: 'duplicate' }
      : row,
  );
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
  };
  for (const row of rows) counts[row.status] += 1;
  return counts;
};
