// The log's «إسترجاع» in its pure parts (2026-10-28 — «ويقدر يرجعه مفتوح لو قبل أو رفض غلط»): what
// restoring one ticket does given what it opened, and what the trail says about it. The writes —
// one transaction, the board, the race with a close — are proven over a real mongod in
// tests/integration/atm-mail-restore.spec.ts.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { mailRestoreChanges, planMailRestore } from './mail-ticket.service';

const open = () => ({ _id: new Types.ObjectId(), closedAt: null, isDeleted: false });
const closed = () => ({
  _id: new Types.ObjectId(),
  closedAt: new Date('2026-10-28T09:00:00.000Z'),
  isDeleted: false,
});
/** A maintenance from the ticket that was deleted on the board — open or closed when it went. */
const deleted = (closedAt: Date | null = null) => ({
  _id: new Types.ObjectId(),
  closedAt,
  isDeleted: true,
});

describe('planMailRestore — one ticket', () => {
  it('skips a ticket already pending: there is nothing to restore', () => {
    expect(planMailRestore('pending', [])).toEqual({ kind: 'skip' });
  });

  it('returns a rejected ticket to pending and removes nothing — a rejection opened nothing', () => {
    expect(planMailRestore('rejected', [])).toEqual({ kind: 'restore', removeMaintenanceIds: [] });
    expect(planMailRestore('rejected', [open()])).toEqual({
      kind: 'restore',
      removeMaintenanceIds: [],
    });
  });

  it('returns an accepted ticket by taking back the open maintenance it opened', () => {
    const row = open();
    expect(planMailRestore('accepted', [row])).toEqual({
      kind: 'restore',
      removeMaintenanceIds: [String(row._id)],
    });
  });

  it('returns an accepted ticket whose maintenance was deleted on the board, removing nothing', () => {
    expect(planMailRestore('accepted', [deleted()])).toEqual({
      kind: 'restore',
      removeMaintenanceIds: [],
    });
    // Deleted, it is off the done page too: a deleted CLOSED one is no record to keep.
    const live = open();
    expect(
      planMailRestore('accepted', [deleted(new Date('2026-10-28T09:00:00.000Z')), live]),
    ).toEqual({
      kind: 'restore',
      removeMaintenanceIds: [String(live._id)],
    });
  });

  it('refuses an accepted ticket no maintenance carries — a legacy accept, nothing to take back', () => {
    expect(planMailRestore('accepted', [])).toEqual({
      kind: 'refuse',
      reason: 'noLinkedMaintenance',
    });
  });

  it('refuses an accepted ticket whose maintenance is closed — closed work is never erased', () => {
    expect(planMailRestore('accepted', [closed()])).toEqual({
      kind: 'refuse',
      reason: 'maintenanceClosed',
    });
    expect(planMailRestore('accepted', [open(), closed()])).toEqual({
      kind: 'refuse',
      reason: 'maintenanceClosed',
    });
  });
});

describe('mailRestoreChanges — the restore row on the trail', () => {
  it('a rejected ticket: the status back to pending, nothing else', () => {
    expect(mailRestoreChanges('rejected', [])).toEqual([
      { field: 'status', old: 'rejected', new: 'pending' },
    ]);
  });

  it("an accepted ticket: the status, and the maintenance it no longer has — accept's change reversed", () => {
    const maintenanceId = String(new Types.ObjectId());
    expect(mailRestoreChanges('accepted', [maintenanceId])).toEqual([
      { field: 'status', old: 'accepted', new: 'pending' },
      { field: 'maintenanceId', old: maintenanceId, new: null },
    ]);
  });
});
