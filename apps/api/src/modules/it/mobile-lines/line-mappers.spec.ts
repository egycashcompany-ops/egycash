// What the register says about a line's paper. An interval can outlive the paper it names — the
// workforce reset keeps the lines' intervals and purges the papers, which carry national IDs — and
// a paper that is gone is not offered: a print or upload button for it could only fail.
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { toItMobileLineAssignmentDto, toItMobileLineDto } from '../it.mappers';
import { type ItMobileLineDoc } from './mobile-line.model';
import { type ItMobileLineAssignmentDoc } from './line-assignment.model';

const at = new Date('2026-10-20T09:00:00.000Z');
const interval = (receiptId: Types.ObjectId | null): ItMobileLineAssignmentDoc =>
  ({
    _id: new Types.ObjectId(),
    lineId: new Types.ObjectId(),
    holderKind: 'employee',
    assignedToEmployeeId: new Types.ObjectId(),
    vehicleCode: null,
    vehiclePlate: null,
    assignedByUserId: null,
    assignedAt: at,
    returnedAt: null,
    returnedToUserId: null,
    notes: null,
    branchId: new Types.ObjectId(),
    receiptId,
    __v: 0,
    createdAt: at,
    updatedAt: at,
  }) as unknown as ItMobileLineAssignmentDoc;

const lineHeldOn = (open: ItMobileLineAssignmentDoc): ItMobileLineDoc =>
  ({
    _id: open.lineId,
    network: 'etisalat',
    phoneNumber: '01100000001',
    accountNumber: null,
    ratePlan: null,
    simKind: 'physical',
    simSerial: null,
    status: 'assigned',
    branchId: open.branchId,
    currentAssignmentId: open._id,
    notes: null,
    __v: 0,
    createdAt: at,
    updatedAt: at,
  }) as unknown as ItMobileLineDoc;

describe('a line’s paper on the register', () => {
  it('is offered when it can be read, with its signed state', () => {
    const paper = new Types.ObjectId();
    const open = interval(paper);
    const dto = toItMobileLineDto(lineHeldOn(open), {
      intervals: new Map([[String(open._id), open]]),
      employees: new Map(),
      receipts: new Map([[String(paper), { signed: true }]]),
    });
    expect(dto.holder).toMatchObject({ receiptId: String(paper), receiptSigned: true });
  });

  it('is not offered once it is gone — no paper, no signed state', () => {
    const open = interval(new Types.ObjectId());
    const dto = toItMobileLineDto(lineHeldOn(open), {
      intervals: new Map([[String(open._id), open]]),
      employees: new Map(),
      receipts: new Map(),
    });
    expect(dto.holder).toMatchObject({ receiptId: null, receiptSigned: null });

    const row = toItMobileLineAssignmentDto(open, new Map(), new Map(), new Map());
    expect(row).toMatchObject({ receiptId: null, receiptSigned: null });
  });
});
