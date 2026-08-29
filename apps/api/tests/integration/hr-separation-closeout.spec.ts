// What an exit closes in the three features that were not listening (P-HR-SEP F1, F2, F3).
//
// THESE ARE THE ASSERTIONS SOURCE GUARDS CANNOT MAKE. A spec that reads the repository can prove a
// filter is written; only a database can prove that the notice does not go out, that the round can
// then be closed, and that the seat comes back. All three defects were invisible in exactly that
// gap — every one of them is a query that runs correctly and returns the wrong rows.
//
// IT DRIVES THE SERVICES DIRECTLY, not HTTP. Every closeout here is a SUBSCRIBER: it has no route,
// no caller and no token, so a spec that went through the API would be testing a door that does
// not exist.
//
// AND IT WRITES ITS FIXTURES THROUGH THE COLLECTION, not through the models. Each row below exists
// to carry two or three fields the closeout actually reads — an employee's `status`, a contract's
// `endDate`, a session's `endsAt` — and a valid employee document needs a job title, a salary, an
// address and a national id, none of which any code under test looks at. Building them would tie
// this spec to four schemas it is not about, so that a required field added to `personal` next
// year fails a separation test for no reason anybody could act on. What the fixtures MUST get
// right is the fields the code reads, and those are listed at each one.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { EmployeeModel } from '../../src/modules/hr/employee-management/employees/employee.model';
import { ContractModel } from '../../src/modules/hr/contracts/contracts/contract.model';
import { contractService } from '../../src/modules/hr/contracts/contracts';
import { PerformanceReviewModel } from '../../src/modules/hr/performance/reviews/performance-review.model';
import {
  performanceReviewRepository,
  performanceReviewService,
} from '../../src/modules/hr/performance';
import { TrainingSessionModel } from '../../src/modules/hr/training/sessions/training-session.model';
import { TrainingEnrollmentModel } from '../../src/modules/hr/training/nominations/training-enrollment.model';
import { trainingNominationService } from '../../src/modules/hr/training';

let replSet: MongoMemoryReplSet | null = null;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-separation-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const DAY = 86_400_000;
const daysFromNow = (days: number): Date => new Date(Date.now() + days * DAY);

let seq = 0;
const nextSeq = (): number => {
  seq += 1;
  return seq;
};

/** An employee row. The closeout reads ONE field of it: `status`. */
const mkEmployee = async (exited: boolean): Promise<string> => {
  const id = new Types.ObjectId();
  const number = String(1000 + nextSeq());
  await EmployeeModel.collection.insertOne({
    _id: id,
    employeeNumber: number,
    code: `EG-${number}`,
    status: exited ? 'exited' : 'active',
    isDeleted: false,
    __v: 0,
  });
  return String(id);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

/**
 * F1 — the two contract sweeps.
 *
 * The failure they had is not that they did nothing; it is that they said two FALSE things about
 * somebody who had already left: «their contract is expiring, renew it», and then «their contract
 * expired», when the contract did not run to its end at all.
 */
describe('the contract sweeps and a holder who has left', () => {
  /** Read by the sweeps: `status`, `endDate`, `isDeleted`, `employeeId`, `expiryNoticeSentAt`. */
  const mkContract = async (employeeId: string, endsInDays: number): Promise<string> => {
    const id = new Types.ObjectId();
    await ContractModel.collection.insertOne({
      _id: id,
      code: `C-${String(nextSeq())}`,
      employeeId: new Types.ObjectId(employeeId),
      employeeName: 'صاحب العقد',
      contractVersion: 1,
      status: 'active',
      startDate: daysFromNow(-400),
      endDate: daysFromNow(endsInDays),
      expiryNoticeSentAt: null,
      isDeleted: false,
      __v: 0,
    });
    return String(id);
  };

  const statusOf = async (id: string): Promise<string> => {
    const doc = await ContractModel.findById(id).lean<{ status: string }>().exec();
    return doc?.status ?? 'missing';
  };

  const noticedAt = async (id: string): Promise<Date | null> => {
    const doc = await ContractModel.findById(id).lean<{ expiryNoticeSentAt: Date | null }>().exec();
    return doc?.expiryNoticeSentAt ?? null;
  };

  it('expires an overdue contract whose holder is still employed', async () => {
    const contractId = await mkContract(await mkEmployee(false), -1);
    await contractService.expireOverdue();
    expect(await statusOf(contractId)).toBe('expired');
  });

  it('leaves an overdue contract alone when its holder has exited', async () => {
    const contractId = await mkContract(await mkEmployee(true), -1);
    await contractService.expireOverdue();
    expect(await statusOf(contractId)).toBe('active');
  });

  /**
   * A contract pointing at nobody is NOT a leaver, and the direction of the read is what decides
   * that. `listExitedIdsSystem` asks who has exited, so an id it cannot resolve falls through to
   * the sweep — a data fault produces a notice about nobody, which somebody sees, rather than a
   * silence nobody discovers.
   */
  it('still expires a contract whose employee record cannot be found', async () => {
    const contractId = await mkContract(String(new Types.ObjectId()), -1);
    await contractService.expireOverdue();
    expect(await statusOf(contractId)).toBe('expired');
  });

  it('notices a contract expiring soon for somebody still employed', async () => {
    const contractId = await mkContract(await mkEmployee(false), 5);
    await contractService.notifyExpiring();
    expect(await noticedAt(contractId)).not.toBeNull();
  });

  /**
   * The leaver's contract is skipped WITHOUT consuming its notice marker. Stamping it would mean a
   * rehire's contract could never be noticed again — a permanent cost to save one query.
   */
  it('sends no notice for a leaver, and does not consume the marker', async () => {
    const contractId = await mkContract(await mkEmployee(true), 5);
    await contractService.notifyExpiring();
    expect(await noticedAt(contractId)).toBeNull();
    expect(await statusOf(contractId)).toBe('active');
  });

  /** D3 — the sweep stops asserting things. It does not become a signatory. */
  it('never terminates a contract, whoever has left', async () => {
    const contractId = await mkContract(await mkEmployee(true), -1);
    await contractService.expireOverdue();
    await contractService.notifyExpiring();
    expect(await statusOf(contractId)).not.toBe('terminated');
  });
});

/**
 * F2 — the review that freezes a round.
 *
 * `close` refuses while any review is neither finalized nor excused, so this is the defect with the
 * widest blast radius of the three: one person resigning holds up everybody else's round, and the
 * refusal names a count rather than a reason.
 */
describe('a performance round with somebody who left in the middle of it', () => {
  /** Read by the closeout: `employeeId`, `status`, `isDeleted`, `cycleId`, and `snapshot`'s fields. */
  const mkReview = async (
    employeeId: string,
    status: string,
    cycleId: Types.ObjectId,
  ): Promise<string> => {
    const id = new Types.ObjectId();
    await PerformanceReviewModel.collection.insertOne({
      _id: id,
      cycleId,
      employeeId: new Types.ObjectId(employeeId),
      employeeName: 'صاحب المراجعة',
      employeeCode: 'EG-R',
      evaluatorId: new Types.ObjectId(),
      evaluatorName: 'المقيّم',
      status,
      rating: status === 'submitted' ? 4 : null,
      strengths: null,
      improvements: null,
      returnedReason: null,
      excusedAt: null,
      excusedBy: null,
      excusedReason: null,
      isDeleted: false,
      __v: 0,
    });
    return String(id);
  };

  const read = async (
    id: string,
  ): Promise<{
    status: string;
    excusedReason: string | null;
    excusedBy: Types.ObjectId | null;
  } | null> =>
    PerformanceReviewModel.findById(id)
      .lean<{ status: string; excusedReason: string | null; excusedBy: Types.ObjectId | null }>()
      .exec();

  it('excuses the draft, naming the exit as the reason', async () => {
    const employeeId = await mkEmployee(true);
    const reviewId = await mkReview(employeeId, 'draft', new Types.ObjectId());
    expect(await performanceReviewService.onEmployeeExited(employeeId)).toBe(1);
    const after = await read(reviewId);
    expect(after?.status).toBe('excused');
    expect(after?.excusedReason).toBe('employee exited');
  });

  /** Nobody excused it — the exit did, and the row says so by leaving the actor null. */
  it('records no person as having excused it', async () => {
    const employeeId = await mkEmployee(true);
    const reviewId = await mkReview(employeeId, 'draft', new Types.ObjectId());
    await performanceReviewService.onEmployeeExited(employeeId);
    expect((await read(reviewId))?.excusedBy).toBeNull();
  });

  /**
   * D4 — a submitted review holds a real evaluation of work the person did. It unblocks the round
   * by being finalized, which is its own path and somebody's decision.
   */
  it('leaves a submitted review untouched', async () => {
    const employeeId = await mkEmployee(true);
    const reviewId = await mkReview(employeeId, 'submitted', new Types.ObjectId());
    expect(await performanceReviewService.onEmployeeExited(employeeId)).toBe(0);
    expect((await read(reviewId))?.status).toBe('submitted');
  });

  it('leaves a finalized review untouched', async () => {
    const employeeId = await mkEmployee(true);
    const reviewId = await mkReview(employeeId, 'finalized', new Types.ObjectId());
    await performanceReviewService.onEmployeeExited(employeeId);
    expect((await read(reviewId))?.status).toBe('finalized');
  });

  it('touches nobody else in the same round', async () => {
    const round = new Types.ObjectId();
    const leaver = await mkEmployee(true);
    const stayer = await mkEmployee(false);
    const theirs = await mkReview(stayer, 'draft', round);
    await mkReview(leaver, 'draft', round);
    await performanceReviewService.onEmployeeExited(leaver);
    expect((await read(theirs))?.status).toBe('draft');
  });

  /** The point of the whole finding: the round becomes closable. */
  it('clears the row that was blocking the close', async () => {
    const round = new Types.ObjectId();
    const leaver = await mkEmployee(true);
    await mkReview(leaver, 'draft', round);
    expect(await performanceReviewRepository.countUnfinished(String(round))).toBe(1);
    await performanceReviewService.onEmployeeExited(leaver);
    expect(await performanceReviewRepository.countUnfinished(String(round))).toBe(0);
  });

  /** A redelivered event finds nothing in `draft` — the filter is the idempotence. */
  it('does nothing on a second delivery', async () => {
    const employeeId = await mkEmployee(true);
    await mkReview(employeeId, 'draft', new Types.ObjectId());
    expect(await performanceReviewService.onEmployeeExited(employeeId)).toBe(1);
    expect(await performanceReviewService.onEmployeeExited(employeeId)).toBe(0);
  });
});

/**
 * F3 — the seat.
 *
 * `occupiesSeat` counts everything but `cancelled`, so a leaver's booking denies a chair to
 * somebody who could have used it, and puts them on a roster for a day they will not be there.
 */
describe('training seats held by somebody who has left', () => {
  /** Read by the closeout: `endsAt`. */
  const mkSession = async (endsInDays: number): Promise<string> => {
    const id = new Types.ObjectId();
    await TrainingSessionModel.collection.insertOne({
      _id: id,
      code: `S-${String(nextSeq())}`,
      courseId: new Types.ObjectId(),
      courseKey: 'safety',
      status: endsInDays < 0 ? 'completed' : 'scheduled',
      startsAt: daysFromNow(endsInDays - 1),
      endsAt: daysFromNow(endsInDays),
      capacity: 10,
      isDeleted: false,
      __v: 0,
    });
    return String(id);
  };

  /** Read by the closeout: `employeeId`, `status`, `isDeleted`, `sessionId`, and the event's names. */
  const mkSeat = async (employeeId: string, sessionId: string, status: string): Promise<string> => {
    const id = new Types.ObjectId();
    await TrainingEnrollmentModel.collection.insertOne({
      _id: id,
      employeeId: new Types.ObjectId(employeeId),
      employeeCode: 'EG-S',
      employeeName: 'صاحب المقعد',
      sessionId: new Types.ObjectId(sessionId),
      sessionCode: 'S',
      courseKey: 'safety',
      status,
      nominationId: null,
      cancelledReason: null,
      enrolledAt: daysFromNow(-10),
      isDeleted: false,
      __v: 0,
    });
    return String(id);
  };

  const read = async (
    id: string,
  ): Promise<{ status: string; cancelledReason: string | null } | null> =>
    TrainingEnrollmentModel.findById(id)
      .lean<{ status: string; cancelledReason: string | null }>()
      .exec();

  it('gives back a seat in a session that has not run', async () => {
    const employeeId = await mkEmployee(true);
    const seatId = await mkSeat(employeeId, await mkSession(7), 'enrolled');
    expect(await trainingNominationService.onEmployeeExited(employeeId)).toBe(1);
    const after = await read(seatId);
    expect(after?.status).toBe('cancelled');
    expect(after?.cancelledReason).toBe('employee exited');
  });

  /**
   * D6 — the cutoff is the SESSION'S end, not the exit date. Somebody who left on the 20th was
   * genuinely in the room on the 12th, and taking that seat back would rewrite what happened.
   */
  it('leaves a seat in a session that already ended', async () => {
    const employeeId = await mkEmployee(true);
    const seatId = await mkSeat(employeeId, await mkSession(-5), 'enrolled');
    expect(await trainingNominationService.onEmployeeExited(employeeId)).toBe(0);
    expect((await read(seatId))?.status).toBe('enrolled');
  });

  it('leaves a seat that was already marked attended', async () => {
    const employeeId = await mkEmployee(true);
    const seatId = await mkSeat(employeeId, await mkSession(7), 'attended');
    await trainingNominationService.onEmployeeExited(employeeId);
    expect((await read(seatId))?.status).toBe('attended');
  });

  it('leaves a seat somebody had already taken back', async () => {
    const employeeId = await mkEmployee(true);
    const seatId = await mkSeat(employeeId, await mkSession(7), 'cancelled');
    expect(await trainingNominationService.onEmployeeExited(employeeId)).toBe(0);
    expect((await read(seatId))?.cancelledReason).toBeNull();
  });

  it('does not take back another person seat in the same session', async () => {
    const sessionId = await mkSession(7);
    const leaver = await mkEmployee(true);
    const stayer = await mkEmployee(false);
    const theirs = await mkSeat(stayer, sessionId, 'enrolled');
    await mkSeat(leaver, sessionId, 'enrolled');
    await trainingNominationService.onEmployeeExited(leaver);
    expect((await read(theirs))?.status).toBe('enrolled');
  });

  it('does nothing on a second delivery', async () => {
    const employeeId = await mkEmployee(true);
    await mkSeat(employeeId, await mkSession(7), 'enrolled');
    expect(await trainingNominationService.onEmployeeExited(employeeId)).toBe(1);
    expect(await trainingNominationService.onEmployeeExited(employeeId)).toBe(0);
  });
});
