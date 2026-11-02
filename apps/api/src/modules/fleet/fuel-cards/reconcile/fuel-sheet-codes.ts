// The fuel companies' car codes, as their sheets spell them — the go-live table and «تذكّر هذا
// الكود».
//
// The go-live sheet (`assets/fleet-go-live/fuel-cards-2026-10-04.json`) keeps beside each card the
// code the company printed (`sheetCode`) and the registry car it was matched to: 43 of its 426
// cards differ — another spelling of a car, or a card on no car under a label. Those spellings are
// the table below (25, once each); `fuel-sheet-codes.spec.ts` pins it to the asset. They are seeded
// at boot INSERT-ONLY: a spelling already on file — above all one the owner taught — is never
// touched, and a re-run writes nothing.
import { type ClientSession, Types } from 'mongoose';
import { logger } from '../../../../infrastructure/logging/logger';
import { foldSheetCode } from './compare-fuel-sheet';
import { type LinkAlias } from './compare-card-links';
import { FleetFuelSheetCodeModel } from './fuel-sheet-codes.model';

/** A spelling and what it names: a car by its registry code, or a label. */
export interface FuelSheetCodeSeed {
  sheetCode: string;
  vehicleCode: string | null;
  label: string | null;
}

const car = (sheetCode: string, vehicleCode: string): FuelSheetCodeSeed => ({
  sheetCode,
  vehicleCode,
  label: null,
});
const label = (sheetCode: string, name = sheetCode): FuelSheetCodeSeed => ({
  sheetCode,
  vehicleCode: null,
  label: name,
});

export const FUEL_SHEET_CODE_SEED: readonly FuelSheetCodeSeed[] = [
  ...[61, 62, 63, 64, 65, 66, 67, 68].map((n) => car(`suz ${String(n)}`, String(n))),
  car('m g 1', 'MG 1'),
  car('m g 2', 'MG 2'),
  car('m g 3', 'MG 3'),
  car('كوستر', 'كوستر 1'),
  car('geely', 'كولراى'),
  car('194', '288'),
  car('فورتشينر 1', 'فورتشنر 1'),
  car('فورتشينر 2', 'فورتشنر 2'),
  car('بيجو', 'بيجو 5008'),
  ...[1, 2, 3, 4, 5, 6].map((n) => label(`سفر ${String(n)}`)),
  label('اسبير'),
  label('تويوتا اللواء'),
];

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/**
 * The go-live spellings, inserted where missing — never updated. Idempotent and boot-safe: two
 * processes booting at once meet on the unique key, and the second writes nothing.
 */
export const seedFuelSheetCodes = async (): Promise<{ inserted: number }> => {
  let inserted = 0;
  const now = new Date();
  for (const seed of FUEL_SHEET_CODE_SEED) {
    try {
      const result = await FleetFuelSheetCodeModel.updateOne(
        { key: foldSheetCode(seed.sheetCode), isDeleted: false },
        {
          $setOnInsert: {
            sheetCode: seed.sheetCode,
            vehicleId: null,
            vehicleCode: seed.vehicleCode,
            label: seed.label,
            source: 'goLive',
            schemaVersion: 1,
            deletedAt: null,
            deletedBy: null,
            createdBy: null,
            updatedBy: null,
            createdAt: now,
            updatedAt: now,
            __v: 0,
          },
        },
        // No `updatedAt` on a row that is already there: an insert-only step changes nothing.
        { upsert: true, timestamps: false },
      ).exec();
      inserted += result.upsertedCount;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }
  if (inserted > 0) logger.info({ inserted }, 'fleet: fuel sheet codes seeded');
  return { inserted };
};

/** Every live spelling, folded → what it names. */
export const fuelSheetCodeAliases = async (): Promise<Map<string, LinkAlias>> => {
  const rows = await FleetFuelSheetCodeModel.find({ isDeleted: false })
    .select({ key: 1, vehicleId: 1, vehicleCode: 1, label: 1 })
    .lean<
      {
        key: string;
        vehicleId: Types.ObjectId | null;
        vehicleCode: string | null;
        label: string | null;
      }[]
    >()
    .exec();
  return new Map(
    rows.map((row) => [
      row.key,
      {
        vehicleId: row.vehicleId == null ? null : String(row.vehicleId),
        vehicleCode: row.vehicleCode ?? null,
        label: row.label ?? null,
      },
    ]),
  );
};

/**
 * «تذكّر هذا الكود» — the owner's pick for a spelling, written (or rewritten) as his: the next sheet
 * that prints it resolves by it. Inside the decision's transaction.
 */
export const rememberFuelSheetCode = async (
  entry: {
    sheetCode: string;
    vehicleId: string | null;
    vehicleCode: string | null;
    label: string | null;
  },
  by: string,
  session: ClientSession,
): Promise<void> => {
  const actor = new Types.ObjectId(by);
  await FleetFuelSheetCodeModel.updateOne(
    { key: foldSheetCode(entry.sheetCode), isDeleted: false },
    {
      $set: {
        sheetCode: entry.sheetCode.trim(),
        vehicleId: entry.vehicleId === null ? null : new Types.ObjectId(entry.vehicleId),
        vehicleCode: entry.vehicleCode,
        label: entry.label,
        source: 'owner',
        updatedBy: actor,
      },
      $setOnInsert: {
        schemaVersion: 1,
        deletedAt: null,
        deletedBy: null,
        createdBy: actor,
      },
      $inc: { __v: 1 },
    },
    { upsert: true, session },
  ).exec();
};
