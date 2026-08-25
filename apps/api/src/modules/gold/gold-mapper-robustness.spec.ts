// A malformed row must not take down the page it appears on.
//
// WHY THIS EXISTS. Five gold registers answered 500 in production — the owners, the delegates, the
// key handovers, عمليات الدخول and عمليات الخروج — while every gate in the repository was green and
// the integration suite listed the same endpoints happily against a real database.
//
// The mappers dereferenced `doc.createdAt.toISOString()`. `timestamps: true` puts that field on
// everything this API writes, which is exactly why the DTOs type it as always present and why
// nothing caught the assumption: the integration suite creates its rows through the API, so its
// rows always have it. A row that reached the collection any other way does not — and one such row
// among twelve good ones returned an unhandled TypeError for the whole page.
//
// So this file feeds every gold mapper a document with each field removed in turn and demands it
// still map. No database, no fixtures from the API: a failure here is a 500 in the browser.
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  toGoldBarDto,
  toGoldCompanyDto,
  toGoldDeliveryReceiptDto,
  toGoldDrawerDto,
  toGoldFloorDto,
  toGoldKeyHandoverDto,
  toGoldReceivingReceiptDto,
  toGoldRepresentativeDto,
  toGoldTransferDto,
  toGoldVaultDto,
} from './gold.mappers';

const oid = (): Types.ObjectId => new Types.ObjectId();
const when = new Date('2024-03-01T09:00:00.000Z');

/** Everything `timestamps: true` and the base fields put on every row. */
const base = {
  _id: oid(),
  __v: 0,
  isDeleted: false,
  createdAt: when,
  updatedAt: when,
  createdBy: oid(),
  updatedBy: oid(),
};

const receiptish = {
  ...base,
  receiptDate: when,
  companyId: oid(),
  representativeId: null,
  barIds: [],
  status: 'draft',
  branchId: null,
  totalWeight: 0,
  barsCount: 0,
  metalType: 'gold',
  notes: null,
  teamLeaderId: null,
  teamLeaderName: null,
  vehicleId: null,
  vehicleNumber: null,
  supervisor1Id: null,
  supervisor1Name: null,
  supervisor2Id: null,
  supervisor2Name: null,
  printCount: 0,
  confirmedAt: null,
  confirmedBy: null,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const MAPPERS: { name: string; doc: Record<string, unknown>; map: (doc: any) => unknown }[] = [
  {
    name: 'company',
    doc: { ...base, name: 'دار السبك', logoFileId: null, type: 'company', phone: null, email: null, status: 'active', notes: null },
    map: (d) => toGoldCompanyDto(d),
  },
  {
    name: 'representative',
    doc: { ...base, companyId: oid(), fullName: 'مندوب', nationalId: null, phone: null, jobTitle: null, joinDate: null, status: 'active', notes: null },
    map: (d) => toGoldRepresentativeDto(d),
  },
  {
    name: 'key handover',
    doc: { ...base, companyId: oid(), representativeId: oid(), vaultId: oid(), drawerId: oid(), handedOverByUserId: null, handoverDate: when, status: 'active', returnedAt: null, returnedByUserId: null, branchId: null, notes: null },
    map: (d) => toGoldKeyHandoverDto(d),
  },
  { name: 'receiving receipt', doc: { ...receiptish, receiptNumber: 'R-1', lines: [] }, map: (d) => toGoldReceivingReceiptDto(d) },
  { name: 'delivery receipt', doc: { ...receiptish, receiptNumber: 'D-1' }, map: (d) => toGoldDeliveryReceiptDto(d) },
  {
    name: 'transfer',
    doc: { ...receiptish, transferNumber: 'T-1', transferDate: when, fromCompanyId: oid(), toCompanyId: oid(), fromRepresentativeId: null, toRepresentativeId: null },
    map: (d) => toGoldTransferDto(d),
  },
  {
    name: 'bar',
    doc: { ...base, serialNumber: 'S-1', brand: null, metalType: 'gold', purity: null, weight: 10, status: 'in_vault', companyId: oid(), currentVaultId: null, currentDrawerId: null, branchId: null, receivingReceiptId: null, deliveryReceiptId: null, notes: null, history: [] },
    map: (d) => toGoldBarDto(d),
  },
  {
    name: 'vault',
    doc: { ...base, name: 'الخزنة', code: 'V1', description: null, status: 'active', layout: null, drawersGenerated: false, floorId: null, order: 1, branchId: null },
    map: (d) => toGoldVaultDto(d, 0),
  },
  { name: 'floor', doc: { ...base, name: 'الدور', order: 1, branchId: null }, map: (d) => toGoldFloorDto(d) },
  {
    name: 'drawer',
    doc: { ...base, vaultId: oid(), number: 1, label: 'A1', row: 1, col: 1, status: 'empty', barsCount: 0, totalWeight: 0, weightLimit: 0, branchId: null },
    map: (d) => toGoldDrawerDto(d),
  },
];
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('every gold mapper survives a row missing any one field', () => {
  it.each(MAPPERS)('$name', ({ doc, map }) => {
    expect(() => map(doc), 'the complete row').not.toThrow();

    // EVERY field, not a chosen few. The point is not that these particular keys are known to go
    // missing — it is that the mapper is the last stop before the wire, and a page must survive
    // whatever the collection actually holds.
    for (const field of Object.keys(doc)) {
      const partial = { ...doc };
      delete partial[field];
      expect(() => map(partial), `missing ${field}`).not.toThrow();
    }

    expect(() => map({ _id: doc._id }), 'nothing but an _id').not.toThrow();
  });
});

describe('every gold mapper survives a row whose values are the WRONG TYPE', () => {
  // `.lean()` does not cast — it returns the raw BSON. A row written by a migration commonly holds
  // an ISO STRING where the schema says Date, so guarding for absence alone closes half the door.
  const WRONG: unknown[] = ['2024-03-01T09:00:00.000Z', '', 0, 'not a date', {}, []];

  it.each(MAPPERS)('$name', ({ doc, map }) => {
    for (const field of Object.keys(doc)) {
      for (const value of WRONG) {
        expect(() => map({ ...doc, [field]: value }), `${field} = ${JSON.stringify(value)}`)
          .not.toThrow();
      }
    }
  });

  it.each(MAPPERS)('$name — with a malformed ELEMENT inside its arrays', ({ doc, map }) => {
    // An empty array proves nothing about the element mapper. A receipt carrying one unreadable
    // line is still a receipt the register has to list.
    for (const field of ['lines', 'barIds', 'history']) {
      if (!(field in doc)) continue;
      for (const element of [null, undefined, {}, 'x', 0]) {
        expect(() => map({ ...doc, [field]: [element] }), `${field}: [${String(element)}]`)
          .not.toThrow();
      }
    }
  });

  it('reads a date stored as an ISO string as that date, not as a fallback', () => {
    const dto = toGoldCompanyDto({
      ...base,
      createdAt: '2024-03-01T09:00:00.000Z',
      name: 'X',
      logoFileId: null,
      type: 'company',
      phone: null,
      email: null,
      status: 'active',
      notes: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(dto.createdAt).toBe('2024-03-01T09:00:00.000Z');
  });
});

describe('the fallback is the truth, not a placeholder', () => {
  it('dates the row by its own ObjectId, which is when it was created', () => {
    const id = new Types.ObjectId();
    const doc = { ...base, _id: id, name: 'X', logoFileId: null, type: 'company', phone: null, email: null, status: 'active', notes: null };
    delete (doc as Partial<typeof doc>).createdAt;
    delete (doc as Partial<typeof doc>).updatedAt;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dto = toGoldCompanyDto(doc as any);
    expect(dto.createdAt).toBe(id.getTimestamp().toISOString());
    expect(dto.updatedAt).toBe(id.getTimestamp().toISOString());
  });

  it('prefers the real timestamp whenever the row carries one', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dto = toGoldCompanyDto({ ...base, name: 'X', logoFileId: null, type: 'company', phone: null, email: null, status: 'active', notes: null } as any);
    expect(dto.createdAt).toBe(when.toISOString());
  });
});
