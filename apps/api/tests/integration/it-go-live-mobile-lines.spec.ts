// The mobile lines imported, against a real mongo — «الـ 3 فايلات دول عبارة عن خطوط موبايل عايز
// أعملهم صفحة لإدارتهم وتسليمهم».
//
// What a source-reading test cannot see: every line registered on its network in its branch — the
// branch found through its spelling, and the whole run refused while one is missing — a line
// handed to its employee on an acknowledgment of its own, a tracker SIM handed to its car on none,
// a holder who has left (or whom HR does not know) given nothing, a suspended line suspended, a
// number the register already holds left alone, and the whole thing done once.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { BranchModel } from '../../src/platform/organization/branches/branch.model';
import { EmployeeModel } from '../../src/modules/hr/employee-management/employees/employee.model';
import { ItMobileLineModel } from '../../src/modules/it/mobile-lines/mobile-line.model';
import { ItMobileLineAssignmentModel } from '../../src/modules/it/mobile-lines/line-assignment.model';
import { ItMobileLineEventModel } from '../../src/modules/it/mobile-lines/line-event.model';
import { ItMobileLineReceiptModel } from '../../src/modules/it/mobile-lines/line-receipt.model';
import { ItGoLiveRunModel } from '../../src/modules/it/go-live/go-live-run.model';
import {
  IT_MOBILE_LINES_MARK,
  MOBILE_LINES_NOTE,
  importItMobileLines,
} from '../../src/modules/it/go-live/mobile-lines';
import { type MobileLineRow } from '../../src/modules/it/go-live/mobile-lines-import';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const AT = new Date('2026-10-20T09:00:00.000Z');
const HQ = new Types.ObjectId();
const ASSIUT = new Types.ObjectId();
const DEPARTMENT = new Types.ObjectId();
const EMPLOYEE = new Types.ObjectId();
const LEAVER = new Types.ObjectId();

const plantBranch = async (_id: Types.ObjectId, code: string, ar: string): Promise<void> => {
  await BranchModel.collection.insertOne({
    _id,
    code,
    name: { ar, en: code },
    status: 'active',
    isDeleted: false,
    deletedAt: null,
    __v: 0,
  });
};

const plantEmployee = async (
  _id: Types.ObjectId,
  code: string,
  fullNameAr: string,
  status: 'active' | 'exited',
): Promise<void> => {
  await EmployeeModel.collection.insertOne({
    _id,
    employeeNumber: code.slice(-4),
    code,
    status,
    personal: { fullNameAr, nationalId: '28001010101010' },
    employment: {
      jobTitleId: new Types.ObjectId(),
      departmentId: DEPARTMENT,
      sectionId: null,
      branchId: HQ,
    },
    branchId: HQ,
    departmentId: DEPARTMENT,
    sectionId: null,
    userId: null,
    exit: null,
    isDeleted: false,
    deletedAt: null,
    __v: 0,
  });
};

const row = (key: string, over: Partial<MobileLineRow>): MobileLineRow => ({
  key,
  network: 'etisalat',
  accountNumber: '6.293541',
  phoneNumber: '01100000000',
  simKind: 'physical',
  simSerial: null,
  ratePlan: 'B.Pro 80 CL0',
  branch: 'المهندسين',
  status: 'inStock',
  holderCode: null,
  registeredToCode: null,
  registeredToLikely: false,
  vehicleCode: null,
  vehiclePlate: null,
  note: null,
  ...over,
});

const LINES: MobileLineRow[] = [
  row('Vodafone صف 6', {
    network: 'vodafone',
    accountNumber: '8.29280625.1',
    phoneNumber: '01034455917',
    simSerial: '8920022022712847788',
    ratePlan: '2025 Business Flex 80',
    status: 'assigned',
    holderCode: '0100006',
  }),
  // The same employee's second line — on a paper of its own.
  row('Etisalat صف 10', {
    phoneNumber: '01100000010',
    simSerial: '8920030821400000010',
    branch: 'أسيوط',
    status: 'assigned',
    holderCode: '0100006',
  }),
  // Settled by the review, but HR says they have left since.
  row('Etisalat صف 11', {
    phoneNumber: '01100000011',
    simSerial: '8920030821400000011',
    status: 'assigned',
    holderCode: '0100001',
  }),
  // A code HR does not know.
  row('Etisalat صف 12', {
    phoneNumber: '01100000012',
    status: 'assigned',
    holderCode: '0100099',
  }),
  row('Etisalat AVL صف 6', {
    accountNumber: '6.293541.214',
    phoneNumber: '01146280982',
    simSerial: '8920030821415127802',
    ratePlan: 'My Fleet +',
    status: 'assigned',
    vehicleCode: '64',
    vehiclePlate: 'ج ك ق 4718',
    note: 'شريحة جهاز تتبع — Suzuki Carry',
  }),
  // Stopped on the network; registered to the leaver — by code, the name is HR's.
  row('Etisalat صف 278', {
    phoneNumber: '01100000278',
    status: 'suspended',
    registeredToCode: '0100001',
    note: 'خط موقوف',
  }),
  // In stock, registered to an employee the review did not settle — named from HR, never the file.
  row('Etisalat صف 7', {
    phoneNumber: '01100000007',
    registeredToCode: '0100006',
    registeredToLikely: true,
  }),
  // Registered by the IT team since the files were made.
  row('Orange صف 11', {
    network: 'orange',
    accountNumber: '6.195509',
    phoneNumber: '01200000011',
    ratePlan: 'اورنج بيزنس ميكس 115',
  }),
];

const lineByNumber = (phoneNumber: string) =>
  ItMobileLineModel.findOne({ phoneNumber, isDeleted: false }).lean().exec();

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  await plantBranch(HQ, 'HQ', 'المهندسين');
  await plantEmployee(EMPLOYEE, '0100006', 'حازم رأفت حازم عبد الوهاب', 'active');
  await plantEmployee(LEAVER, '0100001', 'شريف ممدوح فاروق عزمي', 'exited');
  await ItMobileLineModel.collection.insertOne({
    _id: new Types.ObjectId(),
    network: 'orange',
    phoneNumber: '01200000011',
    accountNumber: '6.195509',
    ratePlan: null,
    simKind: 'physical',
    simSerial: null,
    status: 'inStock',
    branchId: HQ,
    currentAssignmentId: null,
    notes: 'سجّله فريق تقنية المعلومات',
    schemaVersion: 1,
    isDeleted: false,
    deletedAt: null,
    __v: 0,
  });
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

describe('importing the mobile lines', () => {
  it('refuses — writing nothing — while a branch the files name is not in the organisation', async () => {
    const outcome = await importItMobileLines(LINES, AT);

    expect(outcome.status).toBe('refused');
    expect(outcome.status === 'refused' ? outcome.reason : '').toContain('أسيوط: missing');
    expect(await ItMobileLineModel.countDocuments({}).exec()).toBe(1);
    expect(await ItMobileLineAssignmentModel.countDocuments({}).exec()).toBe(0);
    expect(await ItGoLiveRunModel.countDocuments({ key: IT_MOBILE_LINES_MARK }).exec()).toBe(0);

    // The organisation spells it without the hamza; the files with it.
    await plantBranch(ASSIUT, 'AST', 'اسيوط');
  });

  it('registers every line and hands each over to its employee or its car', async () => {
    const outcome = await importItMobileLines(LINES, AT);

    expect(outcome).toMatchObject({
      status: 'done',
      lines: 7,
      inStock: 3,
      assigned: 3,
      toEmployees: 2,
      toCars: 1,
      suspended: 1,
      receipts: 2,
      firstReceipt: 1,
      lastReceipt: 2,
      byNetwork: { vodafone: 1, etisalat: 6 },
      byBranch: { المهندسين: 6, أسيوط: 1 },
      skipped: [{ key: 'Orange صف 11', field: 'phoneNumber', value: '01200000011' }],
      held: [
        { key: 'Etisalat صف 11', holderCode: '0100001', reason: 'leftCompany' },
        { key: 'Etisalat صف 12', holderCode: '0100099', reason: 'unknownEmployee' },
      ],
    });

    // To the employee: the line, its open interval and its history all say so.
    const vodafone = await lineByNumber('01034455917');
    expect(vodafone).toMatchObject({
      network: 'vodafone',
      status: 'assigned',
      simSerial: '8920022022712847788',
      ratePlan: '2025 Business Flex 80',
    });
    expect(String(vodafone?.branchId)).toBe(String(HQ));
    expect(String((await lineByNumber('01100000010'))?.branchId)).toBe(String(ASSIUT));
    const intervals = await ItMobileLineAssignmentModel.find({ assignedToEmployeeId: EMPLOYEE })
      .lean()
      .exec();
    expect(intervals).toHaveLength(2);
    expect(
      intervals.every(
        (i) =>
          i.holderKind === 'employee' &&
          i.returnedAt === null &&
          i.assignedByUserId === null &&
          i.notes === MOBILE_LINES_NOTE,
      ),
    ).toBe(true);
    expect(String(vodafone?.currentAssignmentId)).toBe(
      String(intervals.find((i) => String(i.lineId) === String(vodafone?._id))?._id),
    );

    // ONE acknowledgment per line, the next numbers of the form, the HR snapshot on each.
    const receipts = await ItMobileLineReceiptModel.find({}).sort({ formNumber: 1 }).lean().exec();
    expect(receipts.map((r) => [r.formNumber, r.line.phoneNumber])).toEqual([
      [1, '01034455917'],
      [2, '01100000010'],
    ]);
    for (const receipt of receipts) {
      expect(receipt).toMatchObject({
        employeeCode: '0100006',
        employeeName: 'حازم رأفت حازم عبد الوهاب',
        issuedByUserId: null,
        issuedAt: AT,
        signedCopy: null,
      });
      expect(String(receipt.employeeId)).toBe(String(EMPLOYEE));
    }
    expect(new Set(intervals.map((i) => String(i.receiptId)))).toEqual(
      new Set(receipts.map((r) => String(r._id))),
    );

    // To the car: written as the sheet writes it, on no paper; the row's note on the line.
    const tracker = await lineByNumber('01146280982');
    expect(tracker).toMatchObject({
      status: 'assigned',
      notes: 'شريحة جهاز تتبع — Suzuki Carry',
    });
    const carInterval = await ItMobileLineAssignmentModel.findOne({ lineId: tracker?._id })
      .lean()
      .exec();
    expect(carInterval).toMatchObject({
      holderKind: 'vehicle',
      assignedToEmployeeId: null,
      vehicleCode: '64',
      vehiclePlate: 'ج ك ق 4718',
      receiptId: null,
    });

    // In stock: the holder who left, in the owner's words, and the code HR does not know.
    expect(await lineByNumber('01100000011')).toMatchObject({
      status: 'inStock',
      currentAssignmentId: null,
      notes: 'مسجّل باسم موظف ترك العمل: شريف ممدوح فاروق عزمي (0100001)',
    });
    const unknown = await lineByNumber('01100000012');
    expect(unknown).toMatchObject({ status: 'inStock', currentAssignmentId: null });
    expect(unknown?.notes).toContain('0100099');

    // Registered to somebody HR knows: the name written from HR, in the network's words.
    expect(await lineByNumber('01100000007')).toMatchObject({
      status: 'inStock',
      currentAssignmentId: null,
      notes:
        'مسجّل في الشبكة باسم: حازم رأفت حازم عبد الوهاب (0100006) — مطابقة بالاسم فقط وغير مؤكدة',
    });

    // Suspended, and its history says so after the registration.
    const stopped = await lineByNumber('01100000278');
    expect(stopped).toMatchObject({
      status: 'suspended',
      currentAssignmentId: null,
      notes: 'خط موقوف، مسجّل باسم موظف ترك العمل: شريف ممدوح فاروق عزمي (0100001)',
    });
    const history = await ItMobileLineEventModel.find({ subjectId: stopped?._id })
      .sort({ at: -1, _id: -1 })
      .lean()
      .exec();
    expect(history.map((e) => e.type)).toEqual(['suspended', 'registered']);
    expect(await ItMobileLineEventModel.countDocuments({ type: 'registered' }).exec()).toBe(7);
    expect(await ItMobileLineEventModel.countDocuments({ type: 'assigned' }).exec()).toBe(3);

    // The line already on the register is left as it was.
    expect(await lineByNumber('01200000011')).toMatchObject({
      notes: 'سجّله فريق تقنية المعلومات',
    });
    const run = await ItGoLiveRunModel.findOne({ key: IT_MOBILE_LINES_MARK }).lean().exec();
    expect(run?.outcome).toMatchObject({ lines: 7, receipts: 2 });
  });

  it('happens once: a second boot writes nothing', async () => {
    expect((await importItMobileLines(LINES, AT)).status).toBe('alreadyDone');
    expect(await ItMobileLineModel.countDocuments({}).exec()).toBe(8);
    expect(await ItMobileLineAssignmentModel.countDocuments({}).exec()).toBe(3);
    expect(await ItMobileLineReceiptModel.countDocuments({}).exec()).toBe(2);
  });
});
