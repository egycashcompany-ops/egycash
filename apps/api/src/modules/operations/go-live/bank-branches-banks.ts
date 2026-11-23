// The four banks of the owner's branch lists (Round 29b), and how the deploy finds each one — pure,
// for its spec. The load itself is `bank-branches.ts`.
//
// A BANK IS FOUND BY NAME, NEVER GUESSED. Every live bank («البنوك», stopped ones too) whose
// operations name, Arabic name or English name folds — as the crew board folds an area
// (`foldOperationsAreaName`: «أ إ آ» → «ا», «ى» → «ي», «ة» → «ه», a leading «ال», Latin without
// case) — to one of the file's names (`aliases`) ANSWERS to the file:
//   · exactly one answers by its OPERATIONS name → the file loads into it (unless it is stopped:
//     the step skips it, as the import refuses a stopped bank — `findActiveById`);
//   · exactly one answers by its Arabic or English name only → the same, unless its operations
//     name carries the bank's word all the same («NBE FOREX» named «البنك الأهلي المصري»: a bank
//     of its own beside the main one) or another live bank LOOKS LIKE the file's;
//   · none answers, and no live bank looks like the file's → the bank is CREATED, with the names
//     below («البنوك» is on the owner's list: «عاوز اضيف دول فى البيانات المرجعية تبع (الفروع
//     والبنوك والمناطق)»);
//   · anything else — two answering, one that another file's names find too, one answering by its
//     display name beside a look-alike, none answering beside a look-alike — the file is skipped:
//     which bank is meant is a person's call, and a bank created beside the one the shipments name
//     would hold the owner's branches for good (Round 29b critic).
//
// A BANK LOOKS LIKE the file's when one of its three names, folded, holds one of the file's
// `marks` as whole words: «مصر» / Misr, «الأهلي» / NBE, «القاهرة» / BDC, «التجاري الدولي» / CIB …
// — «بنك مصر إيران», «البنك الأهلي الكويتي», «البنك التجاري الدولي (CIB)», «MISR BANK». Never «مصرف»
// nor «المصري»: a word is matched whole.
//
// THE LEGACY OPERATIONS NAMES ARE ALIASES TOO. `opsName` is the legacy `bank_name_ops` (bank.model.ts)
// and the legacy screens name these banks «مصر», «الأهلي», «القاهرة» and «التجاري الدولي» (contad_app.js
// /vault1's bank order, `main_bank`); ATM's catalog labels them MISR / BM, NBE, CIB (`ATM_BANK_SEED`,
// reports_atm.ejs), and «بنك القاهرة» goes by BDC. A bank held under one of those names alone — all
// three of its names — is still the bank; without them the step would create «بنك مصر» beside «مصر»
// and move the owner's branches onto a bank no shipment names.
import { z } from 'zod';
import { foldOperationsAreaName, tidyOperationsBranchName } from '@ecms/contracts';
import { type BranchSheetRow } from '../bank-branches/import/read-branch-sheet';

export const OPERATIONS_BRANCH_LOAD_BANK_KEYS = [
  'banque-misr',
  'cib',
  'nbe',
  'banque-du-caire',
] as const;
export type OperationsBranchLoadBankKey = (typeof OPERATIONS_BRANCH_LOAD_BANK_KEYS)[number];

export interface OperationsBranchLoadBank {
  key: OperationsBranchLoadBankKey;
  /** The committed file, in `assets/operations-go-live/`. */
  file: string;
  /** What a bank «البنوك» does not hold is created with. */
  create: { opsName: string; name: { ar: string; en: string } };
  /** Every name the bank may be held under. The `create` names are among them. */
  aliases: readonly string[];
  /** The bank's own words: a live bank whose name holds one LOOKS LIKE it (rule above). */
  marks: readonly string[];
}

/** The four, in the order they load — the order the owner listed them. */
export const OPERATIONS_BRANCH_LOAD_BANKS: readonly OperationsBranchLoadBank[] = [
  {
    key: 'banque-misr',
    file: 'bank-branches-banque-misr-2026-11.json',
    create: { opsName: 'بنك مصر', name: { ar: 'بنك مصر', en: 'Banque Misr' } },
    aliases: ['بنك مصر', 'مصر', 'Banque Misr', 'Bank Misr', 'MISR', 'BM'],
    marks: ['مصر', 'Misr', 'Masr'],
  },
  {
    key: 'cib',
    file: 'bank-branches-cib-2026-11.json',
    create: {
      opsName: 'البنك التجاري الدولي',
      name: { ar: 'البنك التجاري الدولي', en: 'Commercial International Bank' },
    },
    aliases: ['CIB', 'البنك التجاري الدولي', 'التجاري الدولي', 'Commercial International Bank'],
    marks: ['CIB', 'التجاري الدولي', 'Commercial International'],
  },
  {
    key: 'nbe',
    file: 'bank-branches-nbe-2026-11.json',
    create: {
      opsName: 'البنك الأهلي المصري',
      name: { ar: 'البنك الأهلي المصري', en: 'National Bank of Egypt' },
    },
    aliases: [
      'البنك الأهلي المصري',
      'البنك الأهلي',
      'الأهلي المصري',
      'الأهلي',
      'NBE',
      'National Bank of Egypt',
    ],
    marks: ['الأهلي', 'NBE', 'Ahly', 'Ahli', 'National Bank'],
  },
  {
    key: 'banque-du-caire',
    file: 'bank-branches-banque-du-caire-2026-11.json',
    create: { opsName: 'بنك القاهرة', name: { ar: 'بنك القاهرة', en: 'Banque du Caire' } },
    aliases: ['بنك القاهرة', 'القاهرة', 'Banque du Caire', 'BDC'],
    marks: ['القاهرة', 'Caire', 'Cairo', 'BDC'],
  },
];

/** A bank name as two are matched: tidied, folded, Latin without case. */
export const foldBankName = (text: string): string =>
  foldOperationsAreaName(tidyOperationsBranchName(text));

/** A live bank as the resolver reads it. */
export interface LiveBank {
  id: string;
  opsName: string;
  name: { ar: string; en: string };
  isActive: boolean;
}

export type BankResolution =
  | { kind: 'found'; bank: LiveBank }
  | { kind: 'missing' }
  | {
      kind: 'ambiguous';
      banks: LiveBank[];
      reason: 'severalBanks' | 'anotherFilesBank' | 'lookalikeBanks';
    };

const namesOf = (bank: LiveBank): string[] =>
  [bank.opsName, bank.name.ar, bank.name.en].map(foldBankName).filter((name) => name !== '');

const aliasesOf = (target: OperationsBranchLoadBank): Set<string> =>
  new Set(target.aliases.map(foldBankName));

const answers = (target: OperationsBranchLoadBank, bank: LiveBank): boolean => {
  const aliases = aliasesOf(target);
  return namesOf(bank).some((name) => aliases.has(name));
};

/** `name` (folded) holds one of the target's marks as whole words. */
const holdsMark = (target: OperationsBranchLoadBank, name: string): boolean =>
  target.marks.map(foldBankName).some((mark) => mark !== '' && ` ${name} `.includes(` ${mark} `));

/** One of the bank's three names holds one of the target's marks (rule above). */
export const looksLike = (target: OperationsBranchLoadBank, bank: LiveBank): boolean =>
  namesOf(bank).some((name) => holdsMark(target, name));

/** The bank `target`'s file loads into, among `banks` — rule above. */
export const resolveLoadBank = (
  target: OperationsBranchLoadBank,
  banks: readonly LiveBank[],
  targets: readonly OperationsBranchLoadBank[] = OPERATIONS_BRANCH_LOAD_BANKS,
): BankResolution => {
  const found = banks.filter((bank) => answers(target, bank));
  if (found.length > 1) return { kind: 'ambiguous', banks: found, reason: 'severalBanks' };
  const bank = found[0];
  if (bank === undefined) {
    const near = banks.filter((other) => looksLike(target, other));
    if (near.length > 0) return { kind: 'ambiguous', banks: near, reason: 'lookalikeBanks' };
    return { kind: 'missing' };
  }
  const others = targets.filter((other) => other.key !== target.key && answers(other, bank));
  if (others.length > 0) return { kind: 'ambiguous', banks: [bank], reason: 'anotherFilesBank' };
  // Found by its Arabic or English name only: its operations name — the one the shipments join on
  // — is another. A bank of its own when that name still carries the bank's word («NBE FOREX»), or
  // when another live bank looks like the file's: a person says which is meant.
  const opsName = foldBankName(bank.opsName);
  if (!aliasesOf(target).has(opsName)) {
    const near = banks.filter((other) => other !== bank && looksLike(target, other));
    if (holdsMark(target, opsName) || near.length > 0) {
      return { kind: 'ambiguous', banks: [bank, ...near], reason: 'lookalikeBanks' };
    }
  }
  return { kind: 'found', bank };
};

/** A new bank's code: one past every code «البنوك» has given, deleted banks' too; 1 for the first. */
export const nextBankCode = (codes: readonly number[]): number =>
  codes.reduce((max, code) => Math.max(max, code), 0) + 1;

// ── The committed file ─────────────────────────────────────────────────────────────────────────

const text = z.string().min(1);

/**
 * One bank's file: the rows of the owner's sheet as the import's own reader read them
 * (`readBranchSheet` — tidied names, a code as the text the cell shows, both area names, the
 * address), and the rows LEFT OUT of it with why: the two whose name Excel had turned into a date.
 */
export const BankBranchesFileSchema = z
  .object({
    source: text,
    bank: z.enum(OPERATIONS_BRANCH_LOAD_BANK_KEYS),
    /** The branch rows the reader read — `rows` and `leftOut` together. */
    rowsRead: z.number().int().min(0),
    leftOut: z.array(
      z
        .object({
          row: z.number().int().min(1),
          problem: z.literal('nameIsDate'),
          nameAsRead: text,
          code: text.nullable(),
          why: text,
        })
        .strict(),
    ),
    rows: z.array(
      z
        .object({
          row: z.number().int().min(1),
          name: text,
          code: text.nullable(),
          areaAr: text.nullable(),
          areaEn: text.nullable(),
          address: text.nullable(),
        })
        .strict(),
    ),
  })
  .strict()
  .refine((file) => file.rows.length + file.leftOut.length === file.rowsRead, {
    message: 'rows and leftOut do not add up to rowsRead',
  });
export type BankBranchesFile = z.infer<typeof BankBranchesFileSchema>;

/** The file read and checked; a file that is not one throws. */
export const parseBankBranchesFile = (json: unknown): BankBranchesFile =>
  BankBranchesFileSchema.parse(json);

/** The file's rows as the planner takes them — a sheet's rows, none of them a date. */
export const sheetRowsOf = (file: BankBranchesFile): BranchSheetRow[] =>
  file.rows.map((row) => ({ ...row, nameIsDate: false }));
