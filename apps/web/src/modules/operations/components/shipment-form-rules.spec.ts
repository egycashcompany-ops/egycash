// The shipment form's rules that live in where the pages and the form are wired, read from their
// source — the form itself needs a browser to render (its dialogs portal), and these are the lines
// a refactor could quietly undo.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const FORM = read('./ShipmentFormDialog.tsx');
// The shared board of the day board, the history and the secured screen — every one of them adds
// through it (`components/ShipmentsBoard.tsx`).
const BOARD = read('./ShipmentsBoard.tsx');
const SECURED = read('../pages/SecuredBacklogPage.tsx');

describe('«اشيل النوع ويكون يومى بس» — the screen decides the type, not a box in the form', () => {
  it('the shipments board creates daily shipments, the secured screen secured ones', () => {
    // The board's own default is daily; the page says otherwise, and the form takes the page's.
    expect(BOARD).toContain("createType = 'daily',");
    expect(BOARD).toContain('createType={createType}');
    // «الفورم بتاعت الاضافى لما اضيف اتوماتيك محصنة».
    expect(SECURED).toContain('createType="secured"');
  });

  it('an edit keeps the shipment’s own type; only a new one takes the screen’s', () => {
    expect(FORM).toContain('shipment?.shipmentType ?? createType');
  });

  it('offers no type choice at all', () => {
    expect(FORM).not.toContain('<option value="secured">');
    expect(FORM).not.toContain('setShipmentType');
  });
});

describe('«المنطقة ميقدر يكتب» — the area follows the TO branch and is not typed', () => {
  it('is shown read only, not as an input', () => {
    expect(FORM).toMatch(/role="textbox"\s+aria-readonly="true"/u);
    expect(FORM).not.toMatch(/setAreaName\(e\.target\.value\)/u);
  });

  it('comes from the destination branch, and goes when that branch goes', () => {
    expect(FORM).toContain('setAreaName(areaOfDestination(branch))');
    // A new TO bank (directly, or by following the main bank) clears the branch AND its area.
    expect(FORM.match(/setDestinationBranchId\(''\);\s*setAreaName\(''\);/gu)?.length).toBe(2);
  });
});

describe('«مينفعش لما يجى يضيف شحنه يختار تاريخ فات» — the dates’ floor', () => {
  it('opens a new shipment on Cairo’s today — whichever screen it is added from', () => {
    // No caller's day to inherit: a default day before today would open the form refused, and the
    // secured register's used to be the UTC day, which is yesterday after a Cairo midnight.
    expect(FORM).toContain('const openedOn = cairoToday();');
    expect(FORM).toContain('setCollectionDate(shipment === null ? openedOn : dateOnly(');
    expect(FORM).not.toContain('defaultDate');
    expect(BOARD).not.toContain('defaultDate');
    expect(SECURED).not.toContain('defaultDate');
  });

  it('floors the collection date at today for a new shipment, at its own day for an edit', () => {
    expect(FORM).toContain(
      'const heldDate = shipment === null ? null : dateOnly(shipment.collectionDate);',
    );
    expect(FORM).toContain('const earliestDate = earliestShipmentDate(heldDate, today);');
    expect(FORM).toMatch(/min=\{earliestDate\}\s+value=\{collectionDate\}/u);
  });

  // The server holds a secured shipment's delivery date to the same floor — and, since Round 8,
  // never before its collection date.
  it('floors a secured shipment’s delivery date the same way, and at the collection date', () => {
    expect(FORM).toContain(
      'const heldDeliveryDate = shipment?.deliveryDate == null ? null : dateOnly(shipment.deliveryDate);',
    );
    expect(FORM).toMatch(
      /const earliestDeliveryDate = deliveryDateMin\(\s*earliestShipmentDate\(heldDeliveryDate, today\),\s*collectionDate,\s*\);/u,
    );
    expect(FORM).toMatch(/min=\{earliestDeliveryDate\}\s+value=\{deliveryDate\}/u);
    expect(FORM).toMatch(
      /shipmentType === 'secured'\s+\? deliveryDateProblem\(deliveryDate, collectionDate, heldDates, day\)\s+: null/u,
    );
  });

  it('names a day typed earlier on its own box', () => {
    expect(FORM).toContain('collection: shipmentDateProblem(collectionDate, heldDate, day),');
    expect(FORM).toContain('error={problemText(dateProblem.collection)}');
    expect(FORM).toContain('error={problemText(dateProblem.delivery)}');
  });

  it('refuses it on save before anything is sent, against today read at that moment', () => {
    const submit = FORM.slice(FORM.indexOf('const submit = async'));
    const check = submit.indexOf('const problems = dateProblems(cairoToday());');
    expect(check).toBeGreaterThanOrEqual(0);
    expect(submit).toContain('const problem = problems.collection ?? problems.delivery;');
    // Checked, and returned from, before either request is built.
    expect(check).toBeLessThan(submit.indexOf('create.mutateAsync'));
    expect(submit.slice(check, submit.indexOf('const core'))).toContain('return;');
  });
});

describe('«تاريخ التسليم تانى يوم الاستلام افتراضى وممكن يغير» — a new محصنة’s delivery date', () => {
  it('opens on the day after the collection date', () => {
    expect(FORM).toContain('const openedOn = cairoToday();');
    expect(FORM).toMatch(
      /shipment === null\s+\? createType === 'secured'\s+\? defaultDeliveryDate\(openedOn\)\s+: ''\s+: dateOnly\(shipment\.deliveryDate\)/u,
    );
  });

  it('follows the collection date until the person picks one — on a new محصنة only', () => {
    const change = FORM.slice(FORM.indexOf('const changeCollectionDate'));
    expect(change).toMatch(
      /if \(!editing && shipmentType === 'secured'\) \{\s+setDeliveryDate\(\(current\) => followCollectionDate\(current, collectionDate, next\)\);/u,
    );
    // The collection box writes through it, never straight to its own state.
    expect(FORM).toContain('onChange={(e) => changeCollectionDate(e.target.value)}');
    expect(FORM).not.toContain('onChange={(e) => setCollectionDate(e.target.value)}');
  });

  it('is required of a new محصنة — named in the missing-fields banner and on its box', () => {
    expect(FORM).toContain(
      'const needsDeliveryDate = deliveryDateRequired(shipmentType, heldDeliveryDate, !editing);',
    );
    expect(FORM).toContain("ok: !needsDeliveryDate || deliveryDate !== '',");
    expect(FORM).toMatch(
      /required=\{needsDeliveryDate\}\s+missing=\{required\.isMissing\('deliveryDate'\)\}/u,
    );
  });

  it('is titled «إضافة محصنة» — the secured screen’s own word for what it adds', () => {
    expect(FORM).toMatch(
      /: shipmentType === 'secured'\s+\? 'operations\.secured\.backlog\.add'\s+: 'operations\.shipment\.add'/u,
    );
  });

  it('names the collection date for what it is on a محصنة — «تاريخ الاستلام»', () => {
    expect(FORM).toContain(
      "shipmentType === 'secured' ? 'operations.board.collectedOn' : 'operations.shipment.form.date',",
    );
  });
});

describe('«ترتيب العملات … على حسب ترتيبها ف شاشة البيانات المرجعية» — the currency pickers', () => {
  it('list the currencies in the catalog’s order, not the order the caller’s list came in', () => {
    expect(FORM).toMatch(
      /const activeCurrencies = useMemo\(\s*\(\) => currencies\.filter\(\(c\) => c\.isActive\)\.sort\(compareCurrencies\),/u,
    );
    // Every line's box offers that list.
    expect(FORM).toMatch(
      /\{activeCurrencies\.map\(\(currency\) => \(\s*<option key=\{currency\.id\}/u,
    );
  });
});

describe('«ومحتاج اشيل دا» — no «تتبّع أرقام الأوراق النقدية» on the form', () => {
  it('has no box for it, and keeps no state of it', () => {
    expect(FORM).not.toContain("t('operations.shipment.serialTracked')");
    expect(FORM).not.toContain('setSerialTracked');
    expect(FORM).not.toContain('<Checkbox');
  });

  it('sends a new shipment the field’s default, and an edit nothing — what is stored stays', () => {
    const create = FORM.slice(FORM.indexOf('await create.mutateAsync'), FORM.indexOf('else\n'));
    expect(create).toContain('serialTracked: false,');
    const core = FORM.slice(
      FORM.indexOf('const core = {'),
      FORM.indexOf('try {', FORM.indexOf('const core = {')),
    );
    expect(core).not.toContain('serialTracked');
  });
});
