// What the «استعاضة معلّقة لحين التحويل» suites share: a real mongo booted with the whole app, one
// registry car, custody receipts written as rows, people with exactly the grants a case needs, and
// the fund's letters and moves through the services (the HTTP cases go through the routes).
//
// Every receipt is planted on its own day and amount by the case that needs it, so each case reads
// its own figures; the fund is one fund, so cases compare the fund before and after, never a
// figure another case left behind.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  CancelFleetCustodyReplenishmentSchema,
  ConfirmFleetCustodyTransferSchema,
  CreateFleetCustodyChargeSchema,
  CreateFleetCustodyMemoSchema,
  CreateFleetCustodyReplenishmentSchema,
  CreateFleetCustodySettlementSchema,
  CreateFleetLicenseExpenseSchema,
  UpdateFleetReceiptSchema,
  type FleetCustodySource,
} from '@ecms/contracts';
import { bootPlatform } from '../../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../../src/modules';
import { buildApp } from '../../../src/app';
import { disconnectMongo } from '../../../src/infrastructure/database/mongo';
import { rbacService } from '../../../src/platform/rbac';
import { authService } from '../../../src/platform/auth';
import { userService } from '../../../src/platform/users';
import { FleetVehicleModel } from '../../../src/modules/fleet/vehicles/vehicle.model';
import { FleetReceiptModel } from '../../../src/modules/fleet/receipts/receipt.model';
import { fleetReceiptService } from '../../../src/modules/fleet/receipts/receipt.service';
import { fleetCustodyMemoService } from '../../../src/modules/fleet/custody/custody-memo.service';
import { fleetCustodyFundService } from '../../../src/modules/fleet/custody/custody-fund.service';
import { fleetCustodyHoldService } from '../../../src/modules/fleet/custody/custody-fund-hold';
import { readCustodyFundTerms } from '../../../src/modules/fleet/custody/custody-fund';
import { fleetLicenseExpenseService } from '../../../src/modules/fleet/license-expenses/license-expense.service';

export const ACTOR = new Types.ObjectId().toString();
const PASSWORD = 'Str0ng#Pass!';

export const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
export const data = <T>(res: { body: unknown }): T => (res.body as { data: T }).data;
/** Σ in piastres, as the fund adds. */
export const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + Math.round(value * 100), 0) / 100;
/** A rejection's HTTP status, as the error handler would send it. */
export const statusOf = (result: PromiseSettledResult<unknown>): number | 'ok' =>
  result.status === 'fulfilled'
    ? 'ok'
    : ((result.reason as { httpStatus?: number }).httpStatus ?? 500);

let replset: MongoMemoryReplSet | undefined;
const car = new Types.ObjectId();

/** The whole app on a fresh database, with the one car every receipt is on. */
export const bootCustody = async (): Promise<Express> => {
  let uri = process.env['MONGO_TEST_URI'];
  if (uri === undefined) {
    replset = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    uri = replset.getUri();
  }
  await bootPlatform({ mongoUri: uri, modules: moduleManifests });
  await FleetVehicleModel.collection.insertOne({
    _id: car,
    code: '601',
    typeId: new Types.ObjectId(),
    plateNumber: 'س ص 601',
    chassisNumber: 'CH-HOLD-601',
    motorNumber: 'MO-HOLD-601',
    joinedAt: day('2026-01-01'),
    licenseExpiresAt: day('2027-01-01'),
    licenseClassId: null,
    operationId: null,
    insuranceCompanyId: null,
    branchId: null,
    departmentId: null,
    radio: { issi: null, motorolaSn: null },
    status: 'active',
    statusReason: null,
    licenseImage: null,
    isDeleted: false,
    schemaVersion: 1,
    __v: 0,
    createdAt: day('2026-01-01'),
    updatedAt: day('2026-01-01'),
  });
  return buildApp();
};

export const stopCustody = async (): Promise<void> => {
  await disconnectMongo();
  await replset?.stop();
};

let users = 0;
/** A user holding exactly `permissionKeys`, and a token signed for them. Named «م م». */
export const tokenWith = async (permissionKeys: string[]): Promise<string> => {
  users += 1;
  const role = await rbacService.createRole(
    { name: { en: `Hold role ${users}`, ar: `دور الاستعاضة ${users}` }, permissionKeys },
    ACTOR,
  );
  const { user } = await userService.create(
    {
      email: `custody-hold-${users}@ecms.local`,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  const userId = String(user._id);
  await userService.setPassword(userId, PASSWORD, 'passwordReset');
  await userService.forceActivate(userId);
  await rbacService.ensureAssignment(userId, String(role._id), 'organization');
  return authService.signAccessToken(userId, new Types.ObjectId().toString(), 0);
};

let written = 0;
/** A live custody receipt, written as the receipts screen leaves it — no `memoId` field at all. */
export const plantReceipt = async (
  iso: string,
  kind: FleetCustodySource,
  amount: number,
): Promise<string> => {
  written += 1;
  const at = new Date(day(iso).getTime() + written * 1000);
  const { insertedId } = await FleetReceiptModel.collection.insertOne({
    date: day(iso),
    vehicleId: car,
    driverEmployeeId: null,
    driverName: 'سائق',
    kind,
    source: 'custody',
    cardId: null,
    fuelType: kind === 'fuel' ? 'diesel' : null,
    pricePerLitre: null,
    litres: null,
    amount,
    odometer: null,
    company: null,
    image: null,
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    createdBy: null,
    updatedBy: null,
    schemaVersion: 1,
    __v: 0,
    createdAt: at,
    updatedAt: at,
  });
  return String(insertedId);
};

export const memo = (kind: FleetCustodySource, receiptIds: string[]) =>
  fleetCustodyMemoService.create(
    CreateFleetCustodyMemoSchema.parse({
      kind,
      lines: receiptIds.map((receiptId) => ({ receiptId })),
    }),
    ACTOR,
  );

/** A memo of one fresh receipt, and its replenishment — held. */
export const heldOne = async (iso: string, amount: number, kind: FleetCustodySource = 'tyres') => {
  const receiptId = await plantReceipt(iso, kind, amount);
  const taken = await memo(kind, [receiptId]);
  const op = await replenish({ date: iso, memoIds: [taken.id] });
  return { receiptId, memoId: taken.id, op };
};

export const charge = (raw: Record<string, unknown>) =>
  fleetCustodyFundService.charge(CreateFleetCustodyChargeSchema.parse(raw), ACTOR);
export const replenish = (raw: Record<string, unknown>) =>
  fleetCustodyFundService.replenish(CreateFleetCustodyReplenishmentSchema.parse(raw), ACTOR);
export const settle = (raw: Record<string, unknown>) =>
  fleetCustodyFundService.settle(CreateFleetCustodySettlementSchema.parse(raw), ACTOR);
export const confirm = (id: string, raw: Record<string, unknown>) =>
  fleetCustodyHoldService.confirmTransfer(id, ConfirmFleetCustodyTransferSchema.parse(raw), ACTOR);
export const cancel = (id: string, raw: Record<string, unknown> = {}) =>
  fleetCustodyHoldService.cancelHeld(id, CancelFleetCustodyReplenishmentSchema.parse(raw), ACTOR);
export const fundNow = async (): Promise<number> => (await readCustodyFundTerms()).fundTotal;

/** A receipt edit as the receipts dialog sends it — the whole receipt back, with `over`. */
export const editReceipt = async (id: string, over: Record<string, unknown>) => {
  const { doc } = await fleetReceiptService.get(id);
  return fleetReceiptService.update(
    id,
    UpdateFleetReceiptSchema.parse({
      date: doc.date.toISOString(),
      vehicleId: String(doc.vehicleId),
      driverEmployeeId: null,
      driverName: doc.driverName ?? null,
      kind: doc.kind,
      cardId: null,
      fuelType: doc.fuelType ?? null,
      amount: doc.amount,
      version: doc.__v,
      ...over,
    }),
    ACTOR,
  );
};

/** A licensing record with one renewal of one car costing `amount` by the card. */
export const licence = (iso: string, amount: number) =>
  fleetLicenseExpenseService.create(
    CreateFleetLicenseExpenseSchema.parse({
      date: iso,
      renewal: {
        vehicles: [{ vehicleId: null, plate: 'ل ت 1' }],
        items: [{ itemId: null, label: 'تجديد', amount, count: 1, paidBy: 'visa', receipt: true }],
      },
      extension: null,
      signatures: { agent: 'أ', director: 'ب', generalManager: 'ج' },
    }),
    ACTOR,
  );
