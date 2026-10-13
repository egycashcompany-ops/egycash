// The entry DTO (D3, §3.8): K values only with `secretsVisible`, the combination never — not even
// sealed — dates as calendar days, and the master's state for the drift badge (DEC-24, DEC-30).
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { type AtmRegisterEntryDoc } from './register.model';
import {
  registerMasterState,
  toAtmRegisterEntryDto,
  type RegisterEntryView,
} from './register.mapper';

const NOW = new Date('2026-10-01T09:00:00.000Z');

const doc = (over: Partial<AtmRegisterEntryDoc> = {}): AtmRegisterEntryDoc => ({
  _id: new Types.ObjectId(),
  schemaVersion: 1,
  isDeleted: false,
  deletedAt: null,
  deletedBy: null,
  createdBy: null,
  updatedBy: null,
  createdAt: NOW,
  updatedAt: NOW,
  __v: 2,
  branchId: new Types.ObjectId(),
  area: 'Smouha',
  bankCode: 'NBE',
  opsBankLabel: null,
  machineCode: '99990001',
  machineId: new Types.ObjectId(),
  name: 'Test ATM',
  operationType: null,
  vendor: null,
  model: null,
  serial: null,
  keys: {
    supervisorCode: 'K-FAKE-1',
    supervisorCount: '2',
    safeDoorCount: null,
    alanki: null,
    combinationKeyCode: null,
    combinationKeyCount: null,
    cashUnitCode: null,
    cashUnitCount: null,
  },
  cassettes: {
    withdrawalType: 'NCR',
    withdrawalCount: null,
    withdrawal1: null,
    withdrawal2: null,
    withdrawal3: null,
    withdrawal4: null,
    withdrawal5: null,
    depositType: null,
    depositCount: null,
    collectionCount: null,
    recycle200: null,
    recycle100: null,
    recycle50: null,
    spareCount: null,
    spare1: null,
    spare2: null,
    spare3: null,
    spare4: null,
    spare5: null,
  },
  openTime: null,
  closeTime: null,
  accessHoursNotes: null,
  receiptNotes: 'fake receipt note',
  safeCombination: { provider: 'platformCrypto', keyId: 'dev1', ref: { ciphertext: 'opaque' } },
  locationPlusCode: null,
  locationUrl: null,
  hub: null,
  startDate: new Date('2026-01-12T00:00:00.000Z'),
  endDate: null,
  receivedByName: null,
  handoverName: null,
  handoverNotes: 'fake handover note',
  status: 'open',
  openPeriodExempt: false,
  source: 'manual',
  importRunId: null,
  importRow: null,
  importIssues: [],
  legacyMarks: null,
  ...over,
});

const view = (over: Partial<RegisterEntryView> = {}): RegisterEntryView => ({
  secretsVisible: true,
  branchCode: 'EGYCASH-4',
  settingOpsLabel: 'NBE',
  linkedMasterState: 'active',
  ...over,
});

describe('toAtmRegisterEntryDto', () => {
  it('hides every K value when !secretsVisible, and never carries the combination at all', () => {
    const dto = toAtmRegisterEntryDto(doc(), view({ secretsVisible: false }));
    expect(dto.secretsVisible).toBe(false);
    expect(dto.keys).toBeNull();
    expect(dto.receiptNotes).toBeNull();
    expect(dto.handoverNotes).toBeNull();
    expect(dto).not.toHaveProperty('safeCombination');
    const raw = JSON.stringify(dto);
    expect(raw).not.toContain('K-FAKE-1');
    expect(raw).not.toContain('fake receipt note');
    expect(raw).not.toContain('opaque');
  });

  it('returns K values to a holder — still without a safeCombination property', () => {
    const dto = toAtmRegisterEntryDto(doc(), view());
    expect(dto.keys?.supervisorCode).toBe('K-FAKE-1');
    expect(dto.receiptNotes).toBe('fake receipt note');
    expect(dto.handoverNotes).toBe('fake handover note');
    expect(dto).not.toHaveProperty('safeCombination');
    expect(JSON.stringify(dto)).not.toContain('opaque');
  });

  it('says only whether a combination is recorded', () => {
    expect(toAtmRegisterEntryDto(doc(), view()).safeCombinationSet).toBe(true);
    expect(toAtmRegisterEntryDto(doc({ safeCombination: null }), view()).safeCombinationSet).toBe(
      false,
    );
  });

  it('writes dates as calendar days', () => {
    const dto = toAtmRegisterEntryDto(
      doc({ endDate: new Date('2026-02-03T00:00:00.000Z'), status: 'ended' }),
      view(),
    );
    expect(dto.startDate).toBe('2026-01-12');
    expect(dto.endDate).toBe('2026-02-03');
  });

  it('passes an imported blank name through as null (DEC-32)', () => {
    expect(toAtmRegisterEntryDto(doc({ name: null }), view()).name).toBeNull();
  });

  it('effective bank label: the override first, then the setting', () => {
    expect(toAtmRegisterEntryDto(doc(), view()).effectiveOpsBankLabel).toBe('NBE');
    expect(
      toAtmRegisterEntryDto(doc({ opsBankLabel: 'NBE FOREX' }), view()).effectiveOpsBankLabel,
    ).toBe('NBE FOREX');
    expect(
      toAtmRegisterEntryDto(doc({ bankCode: null }), view({ settingOpsLabel: null }))
        .effectiveOpsBankLabel,
    ).toBeNull();
  });

  it('reads a row inserted without its sub-documents as all-null', () => {
    const bare = doc();
    delete (bare as Partial<AtmRegisterEntryDoc>).cassettes;
    delete (bare as Partial<AtmRegisterEntryDoc>).keys;
    const dto = toAtmRegisterEntryDto(bare, view());
    expect(dto.cassettes.withdrawalType).toBeNull();
    expect(dto.keys?.supervisorCode).toBeNull();
  });
});

describe('masterState (DEC-24, DEC-30)', () => {
  it('a linked entry shows its master’s live state', () => {
    for (const state of ['active', 'archived', 'deleted', 'missing'] as const) {
      expect(toAtmRegisterEntryDto(doc(), view({ linkedMasterState: state })).masterState).toBe(
        state,
      );
    }
  });

  it('an OPEN entry without a master is unlinked; pending/ended without one have no state', () => {
    expect(registerMasterState({ machineId: null, status: 'open' }, 'missing')).toBe('unlinked');
    expect(registerMasterState({ machineId: null, status: 'pending' }, 'missing')).toBeNull();
    expect(registerMasterState({ machineId: null, status: 'ended' }, 'missing')).toBeNull();
  });
});
