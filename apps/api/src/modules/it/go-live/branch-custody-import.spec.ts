// The branches' custody, line by line — what the owner decided for each kind of line, held here
// against the planner that decides it: «أكمّل الناقص بس» (fill only what is empty, keep and report
// the rest), «انقلهم لفرع الملف» / «كل فرع فى فرعه» (a device in stock elsewhere moves to the sheet's
// branch; one somebody holds does not), «لو مفيش تاجات فخلاص متضيفهمش» (a line left out writes
// nothing) — and the words the asset and its history say it with. The committed file and the
// wiring are `branch-custody.spec.ts`; the writing against a real mongo is
// `tests/integration/it-go-live-branch-custody.spec.ts`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BranchCustodyFileSchema,
  CUSTODY_FIELD_LABELS,
  custodyCategoriesFor,
  custodySet,
  custodySource,
  custodyValueOf,
  newAssetNotes,
  newAssetSpecs,
  newSerialOf,
  otherIdentifierOf,
  planBranchCustody,
  reportBranchCustody,
  transferredHistoryNote,
  updatedHistoryNote,
  writesAsset,
  type CustodyAsset,
  type CustodyDecision,
  type CustodyFillRow,
  type CustodyMoveRow,
  type CustodyNewRow,
  type CustodyRow,
  type CustodySkipRow,
} from './branch-custody-import';
import type { InventoryBranch, LiveCategory } from './inventory-import';

const BRANCHES = new Map<InventoryBranch, string>([
  ['المهندسين', 'branch-hq'],
  ['طنطا', 'branch-tanta'],
  ['بورسعيد', 'branch-portsaid'],
  ['الشروق', 'branch-shorouk'],
  ['أكتوبر', 'branch-october'],
]);

const sheetOf = (branch: InventoryBranch) => ({ sheet: `عهدة فرع ${branch}`, branch });

const fill = (row: number, over: Partial<CustodyFillRow> = {}): CustodyFillRow => ({
  ...sheetOf('طنطا'),
  row,
  kind: 'كمبيوتر مكتبي',
  serial: null,
  tag: 'H4QKWV3',
  action: 'fill',
  registerSerial: 'H4QKWV3',
  specs: {},
  accessories: [],
  ...over,
});

const move = (row: number, over: Partial<CustodyMoveRow> = {}): CustodyMoveRow => ({
  ...sheetOf('الشروق'),
  row,
  kind: 'كمبيوتر مكتبي',
  serial: 'MP30EPE1',
  tag: null,
  action: 'move',
  registerSerial: 'MP30EPE1',
  fromBranch: 'أكتوبر',
  specs: {},
  accessories: [],
  ...over,
});

const fresh = (row: number, over: Partial<CustodyNewRow> = {}): CustodyNewRow => ({
  ...sheetOf('بورسعيد'),
  row,
  kind: 'هاتف IP',
  serial: '271FVCWP20CCCC4D',
  tag: null,
  action: 'new',
  category: 'ipPhone',
  name: 'Grandstream GXP1615',
  manufacturer: 'Grandstream',
  model: 'GXP1615',
  note: null,
  specs: {},
  accessories: [],
  ...over,
});

const skip = (row: number, over: Partial<CustodySkipRow> = {}): CustodySkipRow => ({
  ...sheetOf('طنطا'),
  row,
  kind: 'شاشة',
  serial: '3KB75G3',
  tag: null,
  action: 'skip',
  reason: 'repeatedSerial',
  ...over,
});

const asset = (over: Partial<CustodyAsset> = {}): CustodyAsset => ({
  id: 'asset-1',
  assetCode: 'AST-00001',
  serialNumber: 'H4QKWV3',
  externalTag: null,
  branchId: 'branch-tanta',
  status: 'inStock',
  currentAssignmentId: null,
  specs: null,
  accessories: [],
  manufacturer: 'Dell',
  model: 'OptiPlex 7000',
  location: null,
  ...over,
});

const plan = (rows: CustodyRow[], register: CustodyAsset[]): CustodyDecision[] =>
  planBranchCustody(rows, register, BRANCHES);

/** The one decision a one-line plan makes. */
const decide = (row: CustodyRow, register: CustodyAsset[]): CustodyDecision => {
  const [decision] = plan([row], register);
  if (decision === undefined) throw new Error('no decision');
  return decision;
};

const found = (decision: CustodyDecision) => {
  if (decision.kind !== 'found') throw new Error(`expected found, got ${decision.kind}`);
  return decision;
};

const SPECS = {
  processor: 'Intel Core i7-12700',
  memory: '(1×8) 8',
  systemType: 'Microsoft Windows 11 pro',
  storage: '1TB HDD',
  displayAdapter: 'Intel UHD Graphics 770',
};

describe('a file keeps the owner’s review honest', () => {
  const accepts = (devices: unknown[]) =>
    BranchCustodyFileSchema.safeParse({ source: 'test', devices }).success;

  it('takes one line of each action', () => {
    expect(accepts([fill(2), move(3), fresh(4), skip(5)])).toBe(true);
  });

  it('refuses a sheet row twice', () => {
    expect(accepts([fill(2), fill(2, { tag: 'OTHER01', registerSerial: 'OTHER01' })])).toBe(false);
    // The same row number on another branch's sheet is another line.
    expect(accepts([fill(2), { ...fill(2), ...sheetOf('أكتوبر') }])).toBe(true);
  });

  it('refuses a line to be written that nothing identifies — «لو مفيش تاجات فخلاص متضيفهمش»', () => {
    expect(accepts([fresh(2, { serial: null, tag: null })])).toBe(false);
    expect(accepts([skip(2, { serial: null, reason: 'noSerialOrTag' })])).toBe(true);
    expect(accepts([skip(2, { reason: 'noSerialOrTag' })])).toBe(false);
  });

  it('leaves out a disputed serial only with the serial or tag the owner is to read off the labels', () => {
    const disputed = (over: Partial<CustodySkipRow>) =>
      skip(27, { ...sheetOf('الشروق'), kind: 'طابعة', reason: 'serialDisputed', ...over });
    expect(accepts([disputed({ serial: 'CNDRP8Z666' })])).toBe(true);
    expect(accepts([disputed({ serial: null, tag: 'L8T14AV' })])).toBe(true);
    expect(accepts([disputed({ serial: null, tag: null })])).toBe(false);
    expect(accepts([skip(2, { reason: 'unheardOf' as never })])).toBe(false);
  });

  it('leaves out a label read near another device’s serial only with the label the owner is to read again', () => {
    const near = (over: Partial<CustodySkipRow>) =>
      skip(39, { ...sheetOf('أكتوبر'), reason: 'nearSerial', ...over });
    expect(accepts([near({ serial: null, tag: 'B3SZ8V3' })])).toBe(true);
    expect(accepts([near({ serial: 'B3SZ8V3', tag: null })])).toBe(true);
    expect(accepts([near({ serial: null, tag: null })])).toBe(false);
  });

  it('leaves out a product number in the tag column only where the line has no serial', () => {
    const product = (over: Partial<CustodySkipRow>) =>
      skip(6, { ...sheetOf('أكتوبر'), kind: 'كمبيوتر مكتبي', reason: 'notASerial', ...over });
    expect(accepts([product({ serial: null, tag: 'L8T14AV' })])).toBe(true);
    // A serial identifies the device: the line is not left out for its tag.
    expect(accepts([product({ serial: 'CZC1234ABC', tag: 'L8T14AV' })])).toBe(false);
    expect(accepts([product({ serial: 'L8T14AV', tag: null })])).toBe(false);
    expect(accepts([product({ serial: null, tag: null })])).toBe(false);
  });

  it('refuses a branch the inventory does not know, and a move to where the device is', () => {
    expect(accepts([{ ...fill(2), branch: 'دمياط', sheet: 'عهدة فرع دمياط' }])).toBe(false);
    expect(accepts([move(2, { fromBranch: 'الشروق' })])).toBe(false);
    expect(accepts([{ ...move(2), fromBranch: 'دمياط' }])).toBe(false);
  });

  it('refuses a line on another branch’s sheet, and a register serial the line does not carry', () => {
    expect(accepts([{ ...fill(2), sheet: 'عهدة فرع أكتوبر' }])).toBe(false);
    expect(accepts([fill(2, { registerSerial: 'h4qkwv3' })])).toBe(true);
    expect(accepts([fill(2, { registerSerial: 'H4QKWV4' })])).toBe(false);
  });

  it('carries nothing but the device — no field the review did not write', () => {
    expect(accepts([{ ...fill(2), holder: 'someone' }])).toBe(false);
    expect(accepts([{ ...skip(2), specs: {} }])).toBe(false);
    expect(accepts([fill(2, { specs: { ...SPECS, mediaDrive: 'DVD' } as never })])).toBe(false);
  });
});

describe('the identifiers a new asset is registered under', () => {
  const screen = { serial: 'CN-0DCYGF-QDC00-312-1EEI-A09', tag: '2G76GJ3' };

  it('takes the tag as the serial — a Dell’s service tag is its serial on this register', () => {
    expect(newSerialOf(screen)).toBe('2G76GJ3');
    expect(newSerialOf({ serial: '271FVCWP20CCCC4D', tag: null })).toBe('271FVCWP20CCCC4D');
    expect(newSerialOf({ serial: null, tag: 'L8T14AV' })).toBe('L8T14AV');
    expect(() => newSerialOf({ serial: null, tag: null })).toThrow();
  });

  it('keeps the other one as the printed label, never the serial twice', () => {
    expect(otherIdentifierOf(screen, '2G76GJ3')).toBe('CN-0DCYGF-QDC00-312-1EEI-A09');
    expect(otherIdentifierOf(screen, '2g76gj3')).toBe('CN-0DCYGF-QDC00-312-1EEI-A09');
    expect(otherIdentifierOf(screen, 'CN-0DCYGF-QDC00-312-1EEI-A09')).toBe('2G76GJ3');
    expect(otherIdentifierOf({ serial: null, tag: 'L8T14AV' }, 'L8T14AV')).toBeNull();
    expect(otherIdentifierOf({ serial: 'l8t14av', tag: 'L8T14AV' }, 'L8T14AV')).toBeNull();
    // A serial the line does not carry: which of its two is «other» would be a guess.
    expect(otherIdentifierOf(screen, 'XXXXXXX')).toBeNull();
    expect(otherIdentifierOf(screen, null)).toBeNull();
  });
});

describe('«أكمّل الناقص بس» — only what is empty is filled', () => {
  it('fills every row of the table a device has none of, and makes the whole table', () => {
    const decision = found(decide(fill(2, { specs: SPECS }), [asset({ specs: null })]));
    expect(decision.fill.specs).toEqual(SPECS);
    expect(decision.fields).toEqual([
      'specs.processor',
      'specs.memory',
      'specs.systemType',
      'specs.storage',
      'specs.displayAdapter',
    ]);
    expect(custodySet(decision.asset, decision.fill).specs).toEqual({
      ...SPECS,
      mediaDrive: null,
      graphicsMemory: null,
      networkAdapters: [],
    });
  });

  it('keeps a typed value — reporting it only when the sheet says otherwise — and fills the rest', () => {
    const typed = {
      processor: 'Intel Core i5',
      memory: '  ',
      systemType: null,
      storage: '1tb hdd',
      mediaDrive: 'DVD-RW',
      displayAdapter: null,
      graphicsMemory: null,
      networkAdapters: ['Realtek PCIe GbE'],
    };
    const decision = found(decide(fill(7, { specs: SPECS }), [asset({ specs: typed })]));
    expect(decision.fill.specs).toEqual({
      memory: SPECS.memory,
      systemType: SPECS.systemType,
      displayAdapter: SPECS.displayAdapter,
    });
    // «1tb hdd» is the sheet's «1TB HDD»: kept, and not even reported.
    expect(decision.kept).toEqual([
      { field: 'specs.processor', register: 'Intel Core i5', sheet: SPECS.processor },
    ]);
    // The device's own rows stay exactly as they were.
    expect(custodySet(decision.asset, decision.fill).specs).toEqual({
      ...typed,
      memory: SPECS.memory,
      systemType: SPECS.systemType,
      displayAdapter: SPECS.displayAdapter,
    });
  });

  it('gives accessories only to a device that has none', () => {
    const keyboardAndMouse = fill(2, { accessories: ['Keyboard', 'Mouse'] });
    expect(found(decide(keyboardAndMouse, [asset({ accessories: [] })])).fill.accessories).toEqual([
      'Keyboard',
      'Mouse',
    ]);
    expect(found(decide(keyboardAndMouse, [asset({ accessories: null })])).fields).toEqual([
      'accessories',
    ]);
    // Some already: kept, reported where the sheet lists others, silent where it lists the same.
    expect(decide(keyboardAndMouse, [asset({ accessories: ['Keyboard'] })])).toMatchObject({
      kind: 'complete',
      kept: [{ field: 'accessories', register: 'Keyboard', sheet: 'Keyboard, Mouse' }],
    });
    expect(decide(keyboardAndMouse, [asset({ accessories: ['mouse', 'keyboard'] })])).toMatchObject(
      {
        kind: 'complete',
        kept: [],
      },
    );
    // A line with none takes nothing away.
    expect(decide(fill(2), [asset({ accessories: ['Keyboard'] })]).kind).toBe('complete');
  });

  it('gives a maker and model only to a device registered by hand without them', () => {
    const phone = fresh(40);
    const byHand = asset({
      serialNumber: '271fvcwp20cccc4d',
      branchId: 'branch-portsaid',
      manufacturer: ' ',
      model: 'GXP-1615 HD',
    });
    const decision = found(decide(phone, [byHand]));
    expect(decision.fill).toEqual({ manufacturer: 'Grandstream' });
    expect(decision.kept).toEqual([{ field: 'model', register: 'GXP-1615 HD', sheet: 'GXP1615' }]);
    // A line the review found carries neither, so it never fills them.
    expect(decide(fill(2), [asset({ manufacturer: null, model: null })]).kind).toBe('complete');
  });
});

describe('the printed label — a Dell screen’s «CN-0…» beside its service tag', () => {
  const screen = (over: Partial<CustodyFillRow> = {}) =>
    fill(19, {
      kind: 'شاشة',
      serial: 'CN-0DCYGF-QDC00-312-1EEI-A09',
      tag: '2G76GJ3',
      registerSerial: '2G76GJ3',
      ...over,
    });
  const registered = asset({ serialNumber: '2G76GJ3', manufacturer: 'Dell', model: 'E2020H' });

  it('fills the label the device has none of', () => {
    expect(found(decide(screen(), [registered])).fill).toEqual({
      externalTag: 'CN-0DCYGF-QDC00-312-1EEI-A09',
    });
  });

  it('fills nothing when the line’s only identifier is the serial itself', () => {
    expect(decide(fill(2), [asset()]).kind).toBe('complete');
    expect(decide(screen({ serial: '2g76gj3', tag: '2G76GJ3' }), [registered]).kind).toBe(
      'complete',
    );
  });

  it('keeps a label the device already carries, reporting a different one', () => {
    expect(decide(screen(), [{ ...registered, externalTag: 'OLD-LABEL' }])).toMatchObject({
      kind: 'complete',
      kept: [
        { field: 'externalTag', register: 'OLD-LABEL', sheet: 'CN-0DCYGF-QDC00-312-1EEI-A09' },
      ],
    });
    expect(
      decide(screen(), [{ ...registered, externalTag: 'cn-0dcygf-qdc00-312-1eei-a09' }]),
    ).toMatchObject({ kind: 'complete', kept: [] });
  });

  it('never gives it a label another line of the file names', () => {
    const [first] = plan(
      [screen(), fresh(30, { serial: 'CN-0DCYGF-QDC00-312-1EEI-A09', kind: 'شاشة' })],
      [registered],
    );
    expect(first?.kind).toBe('complete');
  });

  it('never gives it a label another device answers to — that is two devices, and neither is guessed', () => {
    const other = asset({
      id: 'asset-2',
      assetCode: 'AST-00002',
      serialNumber: 'ZZZZZZZ',
      externalTag: 'CN-0DCYGF-QDC00-312-1EEI-A09',
    });
    expect(decide(screen(), [registered, other])).toEqual({
      kind: 'ambiguous',
      row: screen(),
      assetCodes: ['AST-00001', 'AST-00002'],
    });
  });
});

describe('«كل فرع فى فرعه» — where the sheet says the device is', () => {
  it('moves a device in stock in another branch to the sheet’s', () => {
    const decision = found(
      decide(move(16), [asset({ serialNumber: 'MP30EPE1', branchId: 'branch-october' })]),
    );
    expect(decision.move).toEqual({
      fromBranchId: 'branch-october',
      toBranchId: 'branch-shorouk',
      location: null,
    });
    expect(decision.notMoved).toBeNull();
    expect(decision.fields).toEqual([]);
  });

  it('moves it whatever the review planned for the line', () => {
    const decision = found(decide(fill(2), [asset({ branchId: 'branch-hq' })]));
    expect(decision.move).toEqual({
      fromBranchId: 'branch-hq',
      toBranchId: 'branch-tanta',
      location: null,
    });
  });

  it('leaves a device somebody holds where custody put it — reported, and still filled', () => {
    const held = asset({
      branchId: 'branch-hq',
      status: 'assigned',
      currentAssignmentId: 'assignment-1',
    });
    const decision = found(decide(fill(2, { specs: { processor: 'Intel Core i7' } }), [held]));
    expect(decision.move).toBeNull();
    expect(decision.notMoved).toEqual({ status: 'assigned', branchId: 'branch-hq' });
    expect(decision.fill).toEqual({ specs: { processor: 'Intel Core i7' } });
  });

  it('moves nothing an interval is open on, nor one under maintenance', () => {
    const open = asset({ branchId: 'branch-hq', currentAssignmentId: 'assignment-1' });
    expect(found(decide(fill(2), [open])).notMoved).toEqual({
      status: 'inStock',
      branchId: 'branch-hq',
    });
    const repair = asset({ branchId: 'branch-hq', status: 'underMaintenance' });
    expect(found(decide(fill(2), [repair])).notMoved).toMatchObject({ status: 'underMaintenance' });
  });

  it('leaves a planned move alone once the device is already in the sheet’s branch', () => {
    expect(
      decide(move(16), [asset({ serialNumber: 'MP30EPE1', branchId: 'branch-shorouk' })]).kind,
    ).toBe('complete');
  });

  // A location names a place inside the branch the device has left: the head office's «مخزن IT»
  // is no place in Tanta. The move carries it, to be cleared, said and reported.
  it('takes off a moved device the place it had in the branch it leaves', () => {
    const inTheStore = asset({ branchId: 'branch-hq', location: 'مخزن IT' });
    expect(found(decide(fill(25), [inTheStore])).move).toEqual({
      fromBranchId: 'branch-hq',
      toBranchId: 'branch-tanta',
      location: 'مخزن IT',
    });
    // No place, or a blank one: nothing to clear.
    for (const location of [null, '', '   ']) {
      expect(found(decide(fill(25), [{ ...inTheStore, location }])).move, `${location}`).toEqual({
        fromBranchId: 'branch-hq',
        toBranchId: 'branch-tanta',
        location: null,
      });
    }
    const names = new Map([...BRANCHES].map(([name, id]) => [id, name]));
    expect(
      reportBranchCustody(plan([fill(25)], [inTheStore]), [], (id) => names.get(id) ?? id).moved,
    ).toEqual([
      {
        sheet: 'عهدة فرع طنطا',
        row: 25,
        serial: null,
        tag: 'H4QKWV3',
        assetCode: 'AST-00001',
        from: 'المهندسين',
        to: 'طنطا',
        location: 'مخزن IT',
      },
    ]);
  });

  it('leaves the place of a device it does not move — held elsewhere, or filled in its branch', () => {
    const held = asset({
      branchId: 'branch-hq',
      status: 'assigned',
      currentAssignmentId: 'assignment-1',
      location: 'مكتب مدير الفرع',
    });
    const heldDecision = found(decide(fill(2, { specs: { processor: 'Intel Core i7' } }), [held]));
    expect(heldDecision.move).toBeNull();
    expect(heldDecision.notMoved).toEqual({ status: 'assigned', branchId: 'branch-hq' });
    expect(Object.keys(custodySet(heldDecision.asset, heldDecision.fill))).toEqual(['specs']);

    const home = asset({ location: 'خزينة1' });
    const filled = found(
      decide(fill(2, { specs: SPECS, accessories: ['Keyboard', 'Mouse'] }), [home]),
    );
    expect(filled.move).toBeNull();
    expect(filled.notMoved).toBeNull();
    expect(Object.keys(custodySet(filled.asset, filled.fill)).sort()).toEqual([
      'accessories',
      'specs',
    ]);
  });
});

describe('a line and the register', () => {
  it('finds a device by its serial, its tag or the review’s match, without case', () => {
    const decisions = plan(
      [
        fill(2, { serial: null, tag: 'h4qkwv3', registerSerial: 'h4qkwv3' }),
        fill(3, { serial: 'CNDRQ5Q3LZ', tag: null, registerSerial: 'CNDRQ5Q3LZ' }),
      ],
      [
        asset(),
        asset({
          id: 'asset-2',
          assetCode: 'AST-00002',
          externalTag: 'cndrq5q3lz',
          serialNumber: null,
        }),
      ],
    );
    expect(decisions.map((d) => (d.kind === 'complete' ? d.asset.assetCode : d.kind))).toEqual([
      'AST-00001',
      'AST-00002',
    ]);
  });

  it('never guesses between two devices', () => {
    const twins = [
      asset(),
      asset({ id: 'asset-2', assetCode: 'AST-00002', serialNumber: 'h4qkwv3' }),
    ];
    expect(decide(fill(2, { specs: SPECS }), twins)).toMatchObject({
      kind: 'ambiguous',
      assetCodes: ['AST-00001', 'AST-00002'],
    });
  });

  // The all-in-ones' barcode reads «S» before the serial, and the October step takes «S»+serial
  // for the same device: one the IT team scanned in by its barcode is that device.
  it('finds an all-in-one under its barcode’s «S» — SMP30EPE1 is MP30EPE1', () => {
    const scanned = asset({
      serialNumber: 'smp30epe1',
      branchId: 'branch-october',
      manufacturer: 'Lenovo',
      model: 'ThinkCentre neo 50a 24',
    });
    expect(decide(move(16), [scanned])).toMatchObject({
      kind: 'found',
      asset: { assetCode: 'AST-00001' },
      move: { fromBranchId: 'branch-october', toBranchId: 'branch-shorouk' },
    });
    expect(
      decide(move(16, { serial: 'mp30epe1', registerSerial: 'mp30epe1' }), [scanned]),
    ).toMatchObject({ kind: 'found', asset: { assetCode: 'AST-00001' } });
    // A new line for it is the device already there — never a second one.
    const again = fresh(16, {
      ...sheetOf('أكتوبر'),
      kind: 'كمبيوتر مكتبي',
      serial: 'MP30EPE1',
      category: 'allInOne',
      name: 'Lenovo ThinkCentre neo 50a 24',
      manufacturer: 'Lenovo',
      model: 'ThinkCentre neo 50a 24',
    });
    expect(decide(again, [scanned])).toMatchObject({
      kind: 'complete',
      asset: { assetCode: 'AST-00001' },
      kept: [],
      alreadyRegistered: true,
    });
  });

  it('gives no other identifier an «S» twin', () => {
    expect(decide(fill(2), [asset({ serialNumber: 'SH4QKWV3' })])).toEqual({
      kind: 'notFound',
      row: fill(2),
    });
    expect(decide(fresh(40), [asset({ serialNumber: 'S271FVCWP20CCCC4D' })])).toMatchObject({
      kind: 'create',
      serialNumber: '271FVCWP20CCCC4D',
    });
    // Nor does a serial one character longer than an all-in-one's.
    const longer = 'MP30EPE12';
    expect(
      decide(move(16, { serial: longer, registerSerial: longer }), [
        asset({ serialNumber: `S${longer}` }),
      ]),
    ).toMatchObject({ kind: 'notFound' });
  });

  it('never guesses between an all-in-one and its barcode’s spelling, both on the register', () => {
    const register = [
      asset({ serialNumber: 'MP30EPE1', branchId: 'branch-october' }),
      asset({ id: 'asset-2', assetCode: 'AST-00002', serialNumber: 'SMP30EPE1' }),
    ];
    expect(decide(move(16), register)).toMatchObject({
      kind: 'ambiguous',
      assetCodes: ['AST-00001', 'AST-00002'],
    });
  });

  it('reports a device the review found that the register no longer holds — and registers nothing', () => {
    expect(plan([fill(2), move(3)], []).map((d) => d.kind)).toEqual(['notFound', 'notFound']);
  });

  it('registers a new line the register does not hold, under its tag, its other label printed', () => {
    const screen = fresh(19, {
      kind: 'شاشة',
      serial: 'CN-0DCYGF-QDC00-312-1EEI-A09',
      tag: '2G76GJ3',
      category: 'screen',
    });
    expect(decide(screen, [asset()])).toEqual({
      kind: 'create',
      row: screen,
      serialNumber: '2G76GJ3',
      externalTag: 'CN-0DCYGF-QDC00-312-1EEI-A09',
      branchId: 'branch-portsaid',
    });
  });

  it('treats a new line registered by hand since the review as found, and says so', () => {
    const byHand = asset({
      serialNumber: '271FVCWP20CCCC4D',
      branchId: 'branch-hq',
      manufacturer: 'Grandstream',
      model: 'GXP1615',
    });
    expect(decide(fresh(40), [byHand])).toMatchObject({
      kind: 'found',
      alreadyRegistered: true,
      move: { fromBranchId: 'branch-hq', toBranchId: 'branch-portsaid' },
    });
    expect(decide(fresh(40), [{ ...byHand, branchId: 'branch-portsaid' }])).toMatchObject({
      kind: 'complete',
      alreadyRegistered: true,
    });
    expect(decide(fill(2), [asset()])).toMatchObject({
      kind: 'complete',
      alreadyRegistered: false,
    });
  });

  it('lets the first of two lines for one device win', () => {
    const decisions = plan(
      [
        fill(2, { specs: { processor: 'Intel Core i7' } }),
        fill(9, { specs: { processor: 'Intel Core i5' } }),
      ],
      [asset()],
    );
    expect(decisions.map((d) => d.kind)).toEqual(['found', 'duplicateTarget']);
    expect(decisions[1]).toMatchObject({ asset: { assetCode: 'AST-00001' }, first: { row: 2 } });
  });

  it('registers one device once, whichever of its labels the second line repeats', () => {
    const decisions = plan(
      [
        fresh(19, { serial: 'CN-0DCYGF-QDC00-312-1EEI-A09', tag: '2G76GJ3' }),
        fresh(20, { serial: '2g76gj3', tag: null }),
        fresh(21, { serial: 'cn-0dcygf-qdc00-312-1eei-a09', tag: null }),
        fresh(22, { serial: '271FVCWP20CCCC63' }),
      ],
      [],
    );
    expect(decisions.map((d) => d.kind)).toEqual([
      'create',
      'duplicateTarget',
      'duplicateTarget',
      'create',
    ]);
    expect(decisions[1]).toMatchObject({ asset: null, first: { row: 19 } });
  });

  it('writes nothing for a line the review left out — not even on a device it names', () => {
    // The head office's printer holds the serial the Shorouk sheet gives its own: in stock, it
    // would be moved — a second printer at Shorouk — were the line not left out.
    const disputed = skip(27, {
      ...sheetOf('الشروق'),
      kind: 'طابعة',
      serial: 'CNDRP8Z666',
      reason: 'serialDisputed',
    });
    const decisions = plan(
      [skip(24), skip(28, { serial: null, tag: null, reason: 'noSerialOrTag' }), disputed],
      [
        asset({ serialNumber: '3KB75G3', branchId: 'branch-hq' }),
        asset({
          id: 'asset-2',
          assetCode: 'AST-00002',
          serialNumber: 'CNDRP8Z666',
          branchId: 'branch-hq',
        }),
      ],
    );
    expect(decisions).toEqual([
      { kind: 'skipped', row: skip(24), reason: 'repeatedSerial' },
      {
        kind: 'skipped',
        row: skip(28, { serial: null, tag: null, reason: 'noSerialOrTag' }),
        reason: 'noSerialOrTag',
      },
      { kind: 'skipped', row: disputed, reason: 'serialDisputed' },
    ]);
  });

  it('calls a device complete only when it is in its branch with nothing to fill', () => {
    expect(
      decide(fill(2, { specs: { processor: 'Intel Core i7' } }), [
        asset({ specs: { processor: 'Intel Core i5' } }),
      ]),
    ).toMatchObject({
      kind: 'complete',
      kept: [{ field: 'specs.processor' }],
    });
    expect(
      decide(fill(2), [
        asset({ status: 'assigned', currentAssignmentId: 'x', branchId: 'branch-hq' }),
      ]).kind,
    ).toBe('found');
  });
});

describe('what the run writes on a device it found', () => {
  const held = asset({ branchId: 'branch-hq', status: 'assigned', currentAssignmentId: 'a' });

  it('writes nothing on a held device in another branch that lacks nothing — it is only reported', () => {
    const decision = decide(fill(2), [held]);
    expect(decision).toMatchObject({
      kind: 'found',
      fields: [],
      move: null,
      notMoved: { status: 'assigned', branchId: 'branch-hq' },
    });
    expect(writesAsset(decision)).toBe(false);
  });

  it('writes a held device that lacks something, and a device it moves', () => {
    expect(writesAsset(decide(fill(2, { specs: { processor: 'Intel Core i7' } }), [held]))).toBe(
      true,
    );
    expect(
      writesAsset(
        decide(move(16), [asset({ serialNumber: 'MP30EPE1', branchId: 'branch-october' })]),
      ),
    ).toBe(true);
  });

  it('writes nothing for a complete device, nor for a line that found none', () => {
    expect(decide(fill(2), [asset()]).kind).toBe('complete');
    expect(writesAsset(decide(fill(2), [asset()]))).toBe(false);
    for (const decision of plan([skip(24), fill(5), fresh(40)], [])) {
      expect(writesAsset(decision), decision.kind).toBe(false);
    }
  });
});

describe('the category a new device is filed under — its own kind’s, or the run refuses', () => {
  const category = (id: string, ar: string, en = ar): LiveCategory => ({
    id,
    name: { ar, en },
    isActive: true,
  });
  const live = [
    category('c-desktop', 'كمبيوتر مكتبي', 'Desktop computer'),
    category('c-screen', 'شاشات', 'Monitor'),
    category('c-phone', 'تليفون IP'),
  ];

  it('finds each kind its own category, by any of the inventory’s names for it', () => {
    const { categories, missing } = custodyCategoriesFor(live, [
      'ipPhone',
      'screen',
      'ipPhone',
      'desktop',
    ]);
    expect([...categories].map(([key, found]) => [key, found.id])).toEqual([
      ['ipPhone', 'c-phone'],
      ['screen', 'c-screen'],
      ['desktop', 'c-desktop'],
    ]);
    expect(missing).toEqual([]);
  });

  it('never files a kind with no category of its own as a desktop — it is missing', () => {
    const { categories, missing } = custodyCategoriesFor(
      live.filter((item) => item.id !== 'c-phone'),
      ['ipPhone', 'printer', 'screen', 'laptop', 'allInOne'],
    );
    expect(missing).toEqual(['ipPhone', 'printer', 'laptop', 'allInOne']);
    expect([...categories.keys()]).toEqual(['screen']);
  });
});

describe('the report the run row keeps', () => {
  it('names every line by its sheet and row, with what became of it', () => {
    const rows: CustodyRow[] = [
      fill(2, { specs: { processor: 'Intel Core i7' }, accessories: ['Keyboard', 'Mouse'] }),
      move(16),
      fresh(40),
      skip(24),
      fill(5, { tag: 'NOPE001', registerSerial: 'NOPE001' }),
      fill(6, { tag: 'HELD001', registerSerial: 'HELD001' }),
    ];
    const register = [
      asset({ specs: { processor: 'Intel Core i5', memory: null } }),
      asset({
        id: 'asset-2',
        assetCode: 'AST-00002',
        serialNumber: 'MP30EPE1',
        branchId: 'branch-october',
      }),
      asset({
        id: 'asset-3',
        assetCode: 'AST-00003',
        serialNumber: 'HELD001',
        branchId: 'branch-hq',
        status: 'assigned',
        currentAssignmentId: 'a',
      }),
    ];
    const names = new Map([...BRANCHES].map(([name, id]) => [id, name]));
    const report = reportBranchCustody(
      plan(rows, register),
      ['AST-00100'],
      (id) => names.get(id) ?? id,
    );
    const line = (row: CustodyRow) => ({
      sheet: row.sheet,
      row: row.row,
      serial: row.serial,
      tag: row.tag,
    });
    const [first, second, third, fourth, fifth, sixth] = rows as [
      CustodyRow,
      CustodyRow,
      CustodyRow,
      CustodyRow,
      CustodyRow,
      CustodyRow,
    ];

    expect(report).toEqual({
      rows: 6,
      created: [
        {
          ...line(third),
          assetCode: 'AST-00100',
          serialNumber: '271FVCWP20CCCC4D',
          externalTag: null,
          branch: 'بورسعيد',
        },
      ],
      filled: {
        'specs.processor': 0,
        'specs.memory': 0,
        'specs.systemType': 0,
        'specs.storage': 0,
        'specs.displayAdapter': 0,
        accessories: 1,
        externalTag: 0,
        manufacturer: 0,
        model: 0,
      },
      filledAssets: [{ ...line(first), assetCode: 'AST-00001', fields: ['accessories'] }],
      moved: [
        { ...line(second), assetCode: 'AST-00002', from: 'أكتوبر', to: 'الشروق', location: null },
      ],
      notMoved: [
        { ...line(sixth), assetCode: 'AST-00003', status: 'assigned', branch: 'المهندسين' },
      ],
      kept: [
        {
          ...line(first),
          assetCode: 'AST-00001',
          field: 'specs.processor',
          register: 'Intel Core i5',
          sheetValue: 'Intel Core i7',
        },
      ],
      notFound: [{ ...line(fifth), registerSerial: 'NOPE001' }],
      ambiguous: [],
      alreadyRegistered: [],
      duplicateTarget: [],
      skipped: [{ ...line(fourth), reason: 'repeatedSerial' }],
      complete: [],
    });
  });

  it('lists what a complete device keeps, and a new line found complete as already registered', () => {
    const decisions = plan(
      [fill(2, { specs: { processor: 'Intel Core i7' } }), fresh(40)],
      [
        asset({ specs: { processor: 'Intel Core i5' } }),
        asset({
          id: 'asset-2',
          assetCode: 'AST-00002',
          serialNumber: '271FVCWP20CCCC4D',
          branchId: 'branch-portsaid',
          manufacturer: 'Grandstream',
          model: 'GXP1615',
        }),
      ],
    );
    // Both in their branch with nothing they lack: neither is `found`.
    expect(decisions.map((d) => d.kind)).toEqual(['complete', 'complete']);
    const report = reportBranchCustody(decisions, [], (id) => id);
    expect(report.kept).toEqual([
      {
        sheet: 'عهدة فرع طنطا',
        row: 2,
        serial: null,
        tag: 'H4QKWV3',
        assetCode: 'AST-00001',
        field: 'specs.processor',
        register: 'Intel Core i5',
        sheetValue: 'Intel Core i7',
      },
    ]);
    expect(report.alreadyRegistered).toEqual([
      {
        sheet: 'عهدة فرع بورسعيد',
        row: 40,
        serial: '271FVCWP20CCCC4D',
        tag: null,
        assetCode: 'AST-00002',
      },
    ]);
    expect(report.complete.map((entry) => entry.assetCode)).toEqual(['AST-00001', 'AST-00002']);
    expect(report.filledAssets).toEqual([]);
  });

  it('names the asset a repeated new line lost to', () => {
    const decisions = plan([fresh(40), fresh(41)], []);
    expect(reportBranchCustody(decisions, ['AST-00100'], (id) => id).duplicateTarget).toEqual([
      {
        sheet: 'عهدة فرع بورسعيد',
        row: 41,
        serial: '271FVCWP20CCCC4D',
        tag: null,
        assetCode: 'AST-00100',
        first: { sheet: 'عهدة فرع بورسعيد', row: 40 },
      },
    ]);
  });

  it('records each field as the audit row does — before and after', () => {
    const before = asset({ specs: null, accessories: [], externalTag: null });
    const after = custodySet(before, {
      specs: { processor: 'Intel Core i7' },
      accessories: ['Mouse'],
      externalTag: 'CN-0',
    });
    expect(custodyValueOf(before, 'specs.processor')).toBeNull();
    expect(custodyValueOf(after, 'specs.processor')).toBe('Intel Core i7');
    expect(custodyValueOf(before, 'accessories')).toEqual([]);
    expect(custodyValueOf(after, 'accessories')).toEqual(['Mouse']);
    expect(custodyValueOf(after, 'externalTag')).toBe('CN-0');
    expect(custodyValueOf(after, 'model')).toBeNull();
  });
});

describe('what the asset and its history say', () => {
  it('names the owner’s sheet as the source', () => {
    expect(custodySource({ sheet: 'عهدة فرع بورسعيد' })).toBe(
      'من ملف «عهدة فرع بورسعيد» — نوفمبر 2026',
    );
  });

  it('gives a new asset its source, and its line’s note on a line of its own', () => {
    expect(newAssetNotes({ sheet: 'عهدة فرع طنطا', note: null })).toBe(
      'من ملف «عهدة فرع طنطا» — نوفمبر 2026',
    );
    expect(newAssetNotes({ sheet: 'عهدة فرع طنطا', note: 'رقم الهاتف في الملف: 2007' })).toBe(
      'من ملف «عهدة فرع طنطا» — نوفمبر 2026\nرقم الهاتف في الملف: 2007',
    );
  });

  it('gives a new asset the whole table when its line has any of it, and none otherwise', () => {
    expect(newAssetSpecs({})).toBeNull();
    expect(newAssetSpecs({ storage: '512 SSD' })).toEqual({
      processor: null,
      memory: null,
      systemType: null,
      storage: '512 SSD',
      mediaDrive: null,
      displayAdapter: null,
      graphicsMemory: null,
      networkAdapters: [],
    });
  });

  it('names the fields it filled, as the asset screen names them', () => {
    expect(
      updatedHistoryNote({ sheet: 'عهدة فرع طنطا' }, [
        'specs.processor',
        'specs.memory',
        'specs.systemType',
        'specs.storage',
        'specs.displayAdapter',
        'accessories',
        'externalTag',
        'manufacturer',
        'model',
      ]),
    ).toBe(
      'أُضيفت من ملف «عهدة فرع طنطا» — نوفمبر 2026: المعالج، إجمالي ذاكرة النظام، نوع النظام، إجمالي سعة الأقراص الصلبة، نوع محوّل العرض، المشتملات، الملصق المطبوع، الشركة المصنِّعة، الموديل',
    );
  });

  it('says where a device was moved, and on whose word', () => {
    expect(transferredHistoryNote({ sheet: 'عهدة فرع الشروق', branch: 'الشروق' }, null)).toBe(
      'نُقل إلى فرع الشروق حسب ملف «عهدة فرع الشروق» — نوفمبر 2026',
    );
  });

  it('says which place in the branch it left was cleared', () => {
    expect(transferredHistoryNote({ sheet: 'عهدة فرع طنطا', branch: 'طنطا' }, 'مخزن IT')).toBe(
      'نُقل إلى فرع طنطا حسب ملف «عهدة فرع طنطا» — نوفمبر 2026 — وأُزيل الموقع السابق «مخزن IT»',
    );
  });

  it('uses the asset screen’s own labels, word for word', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const i18n = readFileSync(
      join(here, '..', '..', '..', '..', '..', 'web', 'src', 'platform', 'localization', 'i18n.ts'),
      'utf8',
    );
    const keys: Record<keyof typeof CUSTODY_FIELD_LABELS, string> = {
      'specs.processor': 'it.assets.specs.processor',
      'specs.memory': 'it.assets.specs.memory',
      'specs.systemType': 'it.assets.specs.systemType',
      'specs.storage': 'it.assets.specs.storage',
      'specs.displayAdapter': 'it.assets.specs.displayAdapter',
      accessories: 'it.assets.fields.accessories',
      externalTag: 'it.assets.fields.externalTag',
      manufacturer: 'it.assets.fields.manufacturer',
      model: 'it.assets.fields.model',
    };
    for (const [field, key] of Object.entries(keys)) {
      expect(i18n).toContain(`'${key}': '${CUSTODY_FIELD_LABELS[field as keyof typeof keys]}'`);
    }
  });
});
