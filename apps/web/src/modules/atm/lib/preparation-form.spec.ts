// Preparation's capture form (docs/12-planning/atm-settlements-phase1.md §9.3, §9.6, §10.4). All
// values are invented (`SEAL-T-0001` …).
import { type AtmPlanSlot, type AtmPreparationLineDto } from '@ecms/contracts';
import { describe, expect, it } from 'vitest';
import {
  advanceStep,
  applyAdvance,
  cleanScannedValue,
  fieldId,
  fieldOrder,
  isDirty,
  localDuplicates,
  localWarnings,
  mergeAfterConflict,
  nextField,
  requiredMissing,
  resolveConflict,
  saveBodyOf,
  sealKey,
  sealKeyAction,
  seedOnce,
  setFieldValue,
  type CaptureFieldId,
} from './preparation-form';
import * as contracts from '@ecms/contracts';

const ONE_BAG = [{ bag: 1 as const, slots: [1, 2, 3, 4] }];
const TWO_BAGS = [
  { bag: 2 as const, slots: [6, 5] },
  { bag: 1 as const, slots: [1, 2, 3, 4] },
];

const planSlot = (slot: number, notes: number): AtmPlanSlot => ({
  slot,
  kind: 'withdrawal',
  denomination: 200,
  currency: 'EGP',
  notes,
  bag: slot <= 4 ? 1 : 2,
});

const line = (
  version: number,
  seals: Record<number, string | null>,
  qr: string | null = null,
): AtmPreparationLineDto => ({
  lineId: 'line-1',
  planId: 'plan-1',
  serial: 7,
  voidedSerials: [],
  lineStatus: 'issued',
  kind: 'machine',
  machineCode: 'BRKN9001',
  machineName: 'ماكينة اختبار 1',
  area: 'منطقة اختبار',
  hubLabel: null,
  typeLabel: null,
  spareCode: null,
  run: 1,
  scheduleTime: '21:00',
  egpTotalMinor: 0,
  slots: [1, 2].map((n) => planSlot(n, 1000)),
  preparation: {
    id: 'prep-1',
    version,
    status: 'open',
    bags: [{ bag: 1, slots: [1, 2], qr, required: true }],
    seals: [1, 2].map((slot) => ({ slot, value: seals[slot] ?? null, required: true })),
    lastCapturedByName: null,
    lastCapturedAt: null,
    preparedByName: null,
    preparedAt: null,
  },
  progress: { captured: 0, required: 3 },
  warnings: [],
  duplicates: [],
});

describe('the scan order', () => {
  it('one bag: its four cassettes, then its QR', () => {
    expect(fieldOrder(ONE_BAG).map(fieldId)).toEqual([
      'seal:1',
      'seal:2',
      'seal:3',
      'seal:4',
      'qr:1',
    ]);
  });

  it('two bags: bag 1’s cassettes, bag 1’s QR, bag 2’s cassettes in slot order, bag 2’s QR', () => {
    expect(fieldOrder(TWO_BAGS).map(fieldId)).toEqual([
      'seal:1',
      'seal:2',
      'seal:3',
      'seal:4',
      'qr:1',
      'seal:5',
      'seal:6',
      'qr:2',
    ]);
  });

  it('nextField walks the order and stops past the last field', () => {
    const order = fieldOrder(TWO_BAGS);
    expect(nextField(order, 'seal:4')).toEqual({ kind: 'qr', bag: 1 });
    expect(nextField(order, 'qr:1')).toEqual({ kind: 'seal', bag: 2, slot: 5 });
    expect(nextField(order, 'qr:2')).toBeNull();
    expect(nextField(order, 'seal:8')).toBeNull();
  });
});

describe('a key press', () => {
  it('Enter and a scanner’s Tab move on; Shift+Tab and other keys do not', () => {
    expect(sealKeyAction({ key: 'Enter' })).toBe('next');
    expect(sealKeyAction({ key: 'Tab' })).toBe('next');
    expect(sealKeyAction({ key: 'Tab', shiftKey: true })).toBe('none');
    expect(sealKeyAction({ key: 'a' })).toBe('none');
    expect(sealKeyAction({ key: 'Backspace' })).toBe('none');
  });
});

describe('Enter after a scan', () => {
  /** A wedge field as the browser keeps it: typing replaces a full selection, else appends. */
  const fakeField = (id: CaptureFieldId, log: { focused: CaptureFieldId | 'save' | null }) => {
    const field = {
      value: '',
      selected: false,
      focus: () => {
        log.focused = id;
      },
      select: () => {
        field.selected = true;
      },
      type: (text: string) => {
        field.value = field.selected ? text : field.value + text;
        field.selected = false;
      },
    };
    return field;
  };
  const setup = () => {
    const log: { focused: CaptureFieldId | 'save' | null } = { focused: 'seal:1' };
    const ids: CaptureFieldId[] = ['seal:1', 'seal:2', 'seal:3', 'seal:4', 'qr:1'];
    const fields = new Map(ids.map((id) => [id, fakeField(id, log)]));
    const enter = (id: CaptureFieldId): void => {
      const field = fields.get(id);
      if (field === undefined) throw new Error(id);
      field.value = cleanScannedValue(field.value) ?? '';
      applyAdvance(
        advanceStep(ONE_BAG, id, field.value),
        (f) => fields.get(f),
        () => ({
          focus: () => {
            log.focused = 'save';
          },
        }),
      );
    };
    return { log, fields, enter };
  };

  it('moves to the next field, and to «حفظ» past the last', () => {
    expect(advanceStep(ONE_BAG, 'seal:1', 'SEAL-T-0001')).toEqual({
      kind: 'next',
      field: 'seal:2',
    });
    expect(advanceStep(ONE_BAG, 'seal:4', 'SEAL-T-0004')).toEqual({ kind: 'next', field: 'qr:1' });
    expect(advanceStep(ONE_BAG, 'qr:1', 'QR-T-0001')).toEqual({ kind: 'save' });
  });

  it('stays on a value with Arabic letters, its text SELECTED, so the re-scan replaces it', () => {
    const { log, fields, enter } = setup();
    const seal1 = fields.get('seal:1');
    seal1?.type('س-12345');
    enter('seal:1');
    expect(log.focused).toBe('seal:1');
    expect(seal1?.selected).toBe(true);
    // The operator switches the layout and scans the same seal again.
    seal1?.type('S-12345');
    enter('seal:1');
    expect(seal1?.value).toBe('S-12345');
    expect(log.focused).toBe('seal:2');
  });
});

describe('the local checks', () => {
  it('re-exports the contracts’ cleaning and key, not copies', () => {
    expect(cleanScannedValue).toBe(contracts.cleanScannedValue);
    expect(sealKey).toBe(contracts.sealKey);
  });

  it('a repeated seal compares equal across Arabic-Indic digits, case and a trailing CR', () => {
    const found = localDuplicates({
      'seal:1': 'seal-t-٠٠٠١',
      'seal:2': 'SEAL-T-0001\r',
      'seal:3': 'SEAL-T-0003',
    });
    expect(found).toEqual([
      { field: 'seal:1', code: 'SEAL_REPEATED', others: ['seal:2'] },
      { field: 'seal:2', code: 'SEAL_REPEATED', others: ['seal:1'] },
    ]);
  });

  it('a QR equal to a seal is OTHER_FIELD; a QR equal to the other bag’s QR is QR_REPEATED', () => {
    expect(localDuplicates({ 'seal:1': 'SEAL-T-0001', 'qr:1': ' seal-t-0001 ' })).toEqual([
      { field: 'seal:1', code: 'OTHER_FIELD', others: ['qr:1'] },
      { field: 'qr:1', code: 'OTHER_FIELD', others: ['seal:1'] },
    ]);
    expect(localDuplicates({ 'qr:1': 'BAG-T-1', 'qr:2': 'bag-t-1' }).map((d) => d.code)).toEqual([
      'QR_REPEATED',
      'QR_REPEATED',
    ]);
    // Blank fields never match each other.
    expect(localDuplicates({ 'seal:1': '', 'seal:2': '  ', 'qr:1': '\r' })).toEqual([]);
  });

  it('a value typed under the Arabic layout warns', () => {
    expect(localWarnings({ 'seal:1': 'سثشم', 'seal:2': 'SEAL-T-0002' })).toEqual([
      { field: 'seal:1', code: 'ARABIC_LETTERS' },
    ]);
  });
});

describe('requiredMissing — the server’s rule', () => {
  const slots = [planSlot(1, 4000), planSlot(2, 0), planSlot(5, 0), planSlot(6, 0)];
  const prep = {
    bags: [
      { bag: 1 as const, slots: [1, 2], qr: null },
      { bag: 2 as const, slots: [5, 6], qr: null },
    ],
    seals: [
      { slot: 1, value: null },
      { slot: 2, value: null },
      { slot: 5, value: null },
      { slot: 6, value: null },
    ],
  };

  it('a 0-note cassette’s seal and an all-zero bag’s QR are optional', () => {
    expect(requiredMissing(prep, slots)).toEqual([
      { kind: 'seal', slot: 1 },
      { kind: 'qr', bag: 1 },
    ]);
  });

  it('a blank value after cleaning is still missing', () => {
    const filled = {
      ...prep,
      bags: [{ ...prep.bags[0]!, qr: '‏ ' }, prep.bags[1]!],
      seals: [{ slot: 1, value: 'SEAL-T-0001' }, ...prep.seals.slice(1)],
    };
    expect(requiredMissing(filled, slots)).toEqual([{ kind: 'qr', bag: 1 }]);
  });
});

describe('the local values survive a refetch and a 409', () => {
  it('a refetch while the form holds unsaved values keeps them', () => {
    const first = seedOnce(null, line(1, { 1: 'SEAL-T-0001' }));
    const typed = setFieldValue(first, 'seal:2', 'SEAL-T-0002');
    expect(isDirty(typed)).toBe(true);
    const after = seedOnce(typed, line(2, { 1: 'SEAL-T-0009' }));
    expect(after).toBe(typed);
    expect(after.values['seal:2']).toBe('SEAL-T-0002');
  });

  it('a clean form takes what a colleague captured; another line seeds afresh', () => {
    const first = seedOnce(null, line(1, {}));
    const refetched = seedOnce(first, line(2, { 1: 'SEAL-T-0001' }));
    expect(refetched.values['seal:1']).toBe('SEAL-T-0001');
    expect(refetched.version).toBe(2);
    expect(seedOnce(first, line(1, {}))).toBe(first);
    const other = seedOnce(first, { ...line(5, {}), lineId: 'line-2' });
    expect(other.lineId).toBe('line-2');
  });

  it('a form of a preparation that was replaced (reopened, issued again) is dropped, even unsaved', () => {
    // The same line and version, another preparation: the values were scanned for a voided Note.
    const reissued = (version: number): AtmPreparationLineDto => {
      const base = line(version, {});
      return { ...base, serial: 8, preparation: { ...base.preparation, id: 'prep-2' } };
    };
    const typed = setFieldValue(seedOnce(null, line(1, {})), 'seal:1', 'SEAL-T-0001');
    expect(isDirty(typed)).toBe(true);
    const after = seedOnce(typed, reissued(1));
    expect(after).not.toBe(typed);
    expect(after).toMatchObject({ preparationId: 'prep-2', version: 1, conflicts: [] });
    expect(after.values['seal:1']).toBe('');
    expect(isDirty(after)).toBe(false);
    // A 409 answered with the new preparation starts afresh too; nothing typed is carried over.
    const merged = mergeAfterConflict(typed, reissued(4));
    expect(merged).toMatchObject({ preparationId: 'prep-2', version: 4, conflicts: [] });
    expect(isDirty(merged)).toBe(false);
  });

  it('mergeAfterConflict re-applies the user’s values onto the new version', () => {
    const form = setFieldValue(seedOnce(null, line(1, {})), 'seal:1', 'SEAL-T-0001');
    // Meanwhile someone saved slot 2 and the QR.
    const merged = mergeAfterConflict(form, line(2, { 2: 'SEAL-T-0002' }, 'BAG-T-1'));
    expect(merged.version).toBe(2);
    expect(merged.values).toEqual({
      'seal:1': 'SEAL-T-0001',
      'seal:2': 'SEAL-T-0002',
      'qr:1': 'BAG-T-1',
    });
    expect(merged.conflicts).toEqual([]);
    expect(isDirty(merged)).toBe(true);
  });

  it('a field both sides changed is marked for the user to choose', () => {
    const form = setFieldValue(seedOnce(null, line(1, {})), 'seal:1', 'SEAL-T-0001');
    const merged = mergeAfterConflict(form, line(2, { 1: 'SEAL-T-0099' }));
    expect(merged.values['seal:1']).toBe('SEAL-T-0001');
    expect(merged.conflicts).toEqual([{ field: 'seal:1', server: 'SEAL-T-0099' }]);
    // While a conflict is open, a refetch keeps the form.
    expect(seedOnce(merged, line(3, {}))).toBe(merged);
    expect(resolveConflict(merged, 'seal:1', 'server').values['seal:1']).toBe('SEAL-T-0099');
    const kept = resolveConflict(merged, 'seal:1', 'mine');
    expect(kept.values['seal:1']).toBe('SEAL-T-0001');
    expect(kept.conflicts).toEqual([]);
  });

  it('the save body carries every field, blanks as null, at the seeded version', () => {
    const form = setFieldValue(seedOnce(null, line(4, {})), 'seal:2', ' SEAL-T-0002 ');
    expect(saveBodyOf(form, [{ bag: 1, slots: [1, 2] }])).toEqual({
      version: 4,
      bags: [{ bag: 1, qr: null }],
      seals: [
        { slot: 1, value: null },
        { slot: 2, value: ' SEAL-T-0002 ' },
      ],
    });
  });
});
