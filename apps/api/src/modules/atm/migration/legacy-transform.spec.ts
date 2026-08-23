import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  machineFromLegacy,
  machineJoinCodes,
  mailTicketFromLegacy,
  maintenanceFromLegacy,
  refLabelNamesFromLegacy,
  repairLegacyInstant,
  replenishmentFromLegacy,
} from './legacy-transform';

const BRANCH = new Types.ObjectId('64b7f9c2e13b4a0012345678');
const MACHINE = new Types.ObjectId('64b7f9c2e13b4a0012345679');
const NOW = new Date('2026-08-23T09:00:00.000Z');
const id = (): Types.ObjectId => new Types.ObjectId();

describe('repairLegacyInstant — the T1 repair', () => {
  it('reads a Cairo-labelled winter stamp back as the instant it named', () => {
    // Stored 10:00Z by the legacy create path; the operator saw 10:00 Cairo, i.e. 08:00Z.
    expect(
      repairLegacyInstant(new Date('2026-01-15T10:00:00.000Z'), 'cairo-labelled')?.toISOString(),
    ).toBe('2026-01-15T08:00:00.000Z');
  });

  it('applies the DST offset in force at that moment', () => {
    expect(
      repairLegacyInstant(new Date('2026-07-15T10:00:00.000Z'), 'cairo-labelled')?.toISOString(),
    ).toBe('2026-07-15T07:00:00.000Z');
  });

  it('leaves an honest instant alone', () => {
    expect(repairLegacyInstant(new Date('2026-01-15T10:00:00.000Z'), 'utc')?.toISOString()).toBe(
      '2026-01-15T10:00:00.000Z',
    );
  });

  it('passes null through', () => {
    expect(repairLegacyInstant(null, 'cairo-labelled')).toBeNull();
  });
});

describe('machineFromLegacy', () => {
  it('stamps the branch, normalizes the code and reads status 1 as active', () => {
    const row = machineFromLegacy(
      {
        _id: MACHINE,
        bank: 'NBE',
        mach_id: ' 00345 ',
        name: 'Branch ATM',
        area: 'Smouha',
        status: 1,
        deleted: 0,
      },
      BRANCH,
      NOW,
    );
    expect(row).toMatchObject({
      branchId: BRANCH,
      bankName: 'NBE',
      machineCode: '345',
      area: 'Smouha',
      isActive: true,
      isDeleted: false,
    });
  });

  it('carries a deleted machine with its `-D` code verbatim', () => {
    const row = machineFromLegacy(
      { _id: MACHINE, bank: 'CIB', mach_id: '345-D', name: 'x', area: 'y', status: 1, deleted: 1 },
      BRANCH,
      NOW,
    );
    expect(row.machineCode).toBe('345-D');
    expect(row.isDeleted).toBe(true);
    expect(row.deletedAt).toEqual(NOW);
  });
});

describe('machineJoinCodes', () => {
  it('offers the base code as well, so a deleted machine still claims its history', () => {
    expect(machineJoinCodes('345-D')).toEqual(['345-D', '345']);
    expect(machineJoinCodes('345')).toEqual(['345']);
  });
});

describe('replenishmentFromLegacy', () => {
  const doc = {
    _id: id(),
    bank: 'NBE',
    mach_id: '345',
    name: 'Branch ATM',
    zone: '',
    area: 'Smouha',
    open_time: new Date('2026-01-15T10:00:00.000Z'),
    close_time: new Date('2026-01-15T09:30:00.000Z'),
    schedule_time: '10:00',
    leader: 'Ahmed',
    ops_emp: 'Opener',
    ops_emp2: 'Closer',
    end: 1,
    deleted: 0,
  };

  it('repairs the open time and leaves the close time alone — the mixed-epoch fix', () => {
    const row = replenishmentFromLegacy(doc, BRANCH, MACHINE, 'cairo-labelled', NOW);
    expect(row?.openedAt.toISOString()).toBe('2026-01-15T08:00:00.000Z');
    expect(row?.closedAt?.toISOString()).toBe('2026-01-15T09:30:00.000Z');
    // The +3h kludge existed because close − open was negative-ish nonsense; after the repair the
    // duration is the 90 real minutes it always was.
    expect(
      (row as { closedAt: Date; openedAt: Date }).closedAt.getTime() -
        (row as { openedAt: Date }).openedAt.getTime(),
    ).toBe(90 * 60_000);
  });

  it('carries the schedule text and both name snapshots', () => {
    const row = replenishmentFromLegacy(doc, BRANCH, MACHINE, 'utc', NOW);
    expect(row).toMatchObject({
      scheduleTime: '10:00',
      leaderName: 'Ahmed',
      openedByName: 'Opener',
      closedByName: 'Closer',
    });
  });

  it('imports an unclosed row as open', () => {
    const row = replenishmentFromLegacy(
      { ...doc, close_time: null, end: 0 },
      BRANCH,
      MACHINE,
      'utc',
      NOW,
    );
    expect(row?.closedAt).toBeNull();
  });

  it('skips a row with no open time rather than inventing one', () => {
    expect(
      replenishmentFromLegacy({ ...doc, open_time: null }, BRANCH, MACHINE, 'utc', NOW),
    ).toBeNull();
  });
});

describe('maintenanceFromLegacy', () => {
  it('carries service, notes and reference, and marks provenance unknown as manual', () => {
    const row = maintenanceFromLegacy(
      {
        _id: id(),
        bank: 'HDB',
        mach_id: '77',
        area: 'Roushdy',
        open_time: new Date('2026-07-15T09:00:00.000Z'),
        close_time: null,
        service_type: 'Cash dispenser',
        notes: 'waiting parts',
        reference_number: 'REF-9',
        deleted: 0,
      },
      BRANCH,
      MACHINE,
      'utc',
      NOW,
    );
    expect(row).toMatchObject({
      serviceType: 'Cash dispenser',
      notes: 'waiting parts',
      referenceNumber: 'REF-9',
      source: 'manual',
      mailTicketId: null,
      closedAt: null,
    });
  });
});

describe('mailTicketFromLegacy', () => {
  it('maps the numeric status and keeps actionAt null — the legacy never recorded it', () => {
    const row = mailTicketFromLegacy(
      {
        _id: id(),
        bank: 'NBE',
        mach_id: '345',
        name: 'Branch ATM',
        area: 'Smouha',
        open_time: new Date('2026-01-15T07:00:00.000Z'),
        status: 1,
        status_txt: 'cash dispenser jammed',
        action_by: 'Operator',
        sender_mail: 'alerts@bank.example',
        duplication: 1,
        found: 1,
      },
      BRANCH,
      MACHINE,
    );
    expect(row).toMatchObject({
      status: 'accepted',
      issueText: 'cash dispenser jammed',
      actionByName: 'Operator',
      actionAt: null,
      providerMessageId: null,
      duplicationAtIngest: true,
      foundInMaster: true,
    });
  });

  it('maps 0 and 2 to pending and rejected', () => {
    const base = {
      _id: id(),
      mach_id: '1',
      open_time: new Date('2026-01-15T07:00:00.000Z'),
      status_txt: 'x',
      sender_mail: 'a@b.c',
    };
    expect(mailTicketFromLegacy({ ...base, status: 0 }, BRANCH, null)?.status).toBe('pending');
    expect(mailTicketFromLegacy({ ...base, status: 2 }, BRANCH, null)?.status).toBe('rejected');
  });
});

describe('refLabelNamesFromLegacy', () => {
  it('drops blanks and repeats the legacy `$push` never guarded against', () => {
    expect(refLabelNamesFromLegacy(['NBE', ' ', 'CIB', 'NBE', ''])).toEqual(['NBE', 'CIB']);
  });

  it('answers empty for a missing array', () => {
    expect(refLabelNamesFromLegacy(undefined)).toEqual([]);
  });
});
