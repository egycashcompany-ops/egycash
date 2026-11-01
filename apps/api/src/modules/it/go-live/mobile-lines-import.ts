// The company's mobile lines — the three files the networks sent («Vodafone.xlsx», «Etisalat.xlsx»,
// «Orange.xls») — as the go-live reads them. «الـ 3 فايلات دول عبارة عن خطوط موبايل عايز أعملهم
// صفحة لإدارتهم وتسليمهم».
//
// The files were read and reviewed with the owner BEFORE anything was written: every line given
// its branch, the employee or the car that holds it, and its state on the network. What came out of
// that review is `assets/it-go-live/mobile-lines-2026-10.json`, and this file is the part of the
// go-live that is pure: the file's shape and the rules a reviewed row keeps. The writing is
// `mobile-lines.ts`.
//
// NOTHING FROM HR IS IN THE FILE BUT A CODE, AND NO PERSON IS NAMED IN IT. The repository is
// public, so the file carries what the company's register needs and nobody's name: a line handed
// to an employee names them by employee code, and the name, the national ID and the rest of the
// acknowledgment are read from HR when it is written, as every hand-over's are. A line in stock
// that the network has registered to somebody HR knows — a leaver, a likely match the review left
// unsettled, the holder of a suspended line — carries that person's code as `registeredToCode`,
// and the import writes their name from HR into the line's notes. Somebody HR does not know is
// described in the row's `note`, never named.
import { z } from 'zod';
import { IT_MOBILE_NETWORKS, IT_MOBILE_SIM_KINDS, normalizeEgyptianPhone } from '@ecms/contracts';
import { INVENTORY_BRANCHES } from './inventory-import';

/** A line's state as the review found it — the register's three, nothing derived from elsewhere. */
export const MOBILE_LINE_IMPORT_STATUSES = ['inStock', 'assigned', 'suspended'] as const;

const text = z.string().trim().min(1);

export const MobileLineRowSchema = z
  .object({
    /** «Vodafone صف 6» — the file and the row the line came from; what the report names it by. */
    key: text,
    network: z.enum(IT_MOBILE_NETWORKS),
    /** The network account it is billed on — the register's own limit. */
    accountNumber: text.max(40).nullable(),
    // Exactly the form the register stores, so the unique index compares like with like: a
    // number written any other way would be a second row for the same SIM.
    phoneNumber: z
      .string()
      .refine((value) => normalizeEgyptianPhone(value) === value, 'an 11-digit local number'),
    simKind: z.enum(IT_MOBILE_SIM_KINDS),
    /** The ICCID as ASCII digits; null for the eSIM, and for the cards the network did not list. */
    simSerial: z
      .string()
      .regex(/^\d{18,22}$/u)
      .nullable(),
    ratePlan: text.max(120).nullable(),
    // The branches the inventory already found by name — one list, one matcher.
    branch: z.enum(INVENTORY_BRANCHES),
    status: z.enum(MOBILE_LINE_IMPORT_STATUSES),
    /** The employee it is handed to — only for an `assigned` line the review settled. */
    holderCode: z
      .string()
      .regex(/^\d{7}$/u)
      .nullable(),
    /**
     * A line nobody holds that the network has registered to an employee HR knows — by code; the
     * name is written from HR at import («مسجّل باسم موظف ترك العمل: …»). Never on a line handed over.
     */
    registeredToCode: z
      .string()
      .regex(/^\d{7}$/u)
      .nullable(),
    /**
     * The review matched `registeredToCode` by NAME only — the network's record did not confirm it
     * — so the note says the match is unconfirmed rather than naming the person as a fact.
     */
    registeredToLikely: z.boolean(),
    /** The car a tracker SIM is in, as the network's sheet writes it — text, never a Fleet id. */
    vehicleCode: text.max(40).nullable(),
    vehiclePlate: text.max(40).nullable(),
    note: text.max(2000).nullable(),
  })
  .strict();
export type MobileLineRow = z.infer<typeof MobileLineRowSchema>;

/** Whether the row names a car — by its code, its plate or both. */
export const rowNamesCar = (row: MobileLineRow): boolean =>
  row.vehicleCode !== null || row.vehiclePlate !== null;

export const MobileLinesFileSchema = z
  .object({
    source: text,
    lines: z.array(MobileLineRowSchema).min(1),
  })
  .strict()
  .superRefine((file, ctx) => {
    const issue = (index: number, field: keyof MobileLineRow, message: string): void => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lines', index, field], message });
    };
    const keys = new Set<string>();
    const numbers = new Set<string>();
    const serials = new Set<string>();
    file.lines.forEach((row, index) => {
      if (keys.has(row.key)) issue(index, 'key', `${row.key} appears twice`);
      keys.add(row.key);
      // The register's unique indexes, held before the database is asked: one number one line,
      // one card one line.
      if (numbers.has(row.phoneNumber)) {
        issue(index, 'phoneNumber', `number ${row.phoneNumber} appears twice`);
      }
      numbers.add(row.phoneNumber);
      if (row.simSerial !== null) {
        if (serials.has(row.simSerial)) {
          issue(index, 'simSerial', `SIM serial ${row.simSerial} appears twice`);
        }
        serials.add(row.simSerial);
      }
      // The register's own rule: an eSIM has no card to read a serial from.
      if (row.simKind === 'esim' && row.simSerial !== null) {
        issue(index, 'simSerial', `${row.key} is an eSIM; it has no card serial`);
      }
      // A line handed over is held by ONE holder — an employee or a car, never both or neither;
      // a line in stock or suspended is held by nobody.
      const toCar = rowNamesCar(row);
      if (row.status === 'assigned') {
        if ((row.holderCode !== null) === toCar) {
          issue(
            index,
            'holderCode',
            `${row.key} is handed over to an employee or to a car — exactly one`,
          );
        }
      } else if (row.holderCode !== null || toCar) {
        issue(index, 'holderCode', `${row.key} is ${row.status}; nobody holds it`);
      }
      if (row.status === 'assigned' && row.registeredToCode !== null) {
        issue(index, 'registeredToCode', `${row.key} is handed over; its holder is the record`);
      }
      if (row.registeredToLikely && row.registeredToCode === null) {
        issue(index, 'registeredToLikely', `${row.key} names no code to be unsure of`);
      }
    });
  });
export type MobileLinesFile = z.infer<typeof MobileLinesFileSchema>;

export const parseMobileLines = (json: unknown): MobileLinesFile =>
  MobileLinesFileSchema.parse(json);
