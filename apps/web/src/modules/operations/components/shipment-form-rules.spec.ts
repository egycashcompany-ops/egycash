// The shipment form's rules that live in where the pages and the form are wired, read from their
// source — the form itself needs a browser to render (its dialogs portal), and these are the lines
// a refactor could quietly undo.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const FORM = read('./ShipmentFormDialog.tsx');
// The day board's and the history's board — both add through it (`components/ShipmentsBoard.tsx`).
const BOARD = read('./ShipmentsBoard.tsx');
const SECURED = read('../pages/SecuredBacklogPage.tsx');

describe('«اشيل النوع ويكون يومى بس» — the screen decides the type, not a box in the form', () => {
  it('the shipments board creates daily shipments, the secured register secured ones', () => {
    expect(BOARD).toContain('createType="daily"');
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
    expect(FORM).toContain('setCollectionDate(shipment === null ? cairoToday() : dateOnly(');
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

  // The server holds a secured shipment's delivery date to the same floor.
  it('floors a secured shipment’s delivery date the same way — a first one at today', () => {
    expect(FORM).toContain(
      'const heldDeliveryDate = shipment?.deliveryDate == null ? null : dateOnly(shipment.deliveryDate);',
    );
    expect(FORM).toContain(
      'const earliestDeliveryDate = earliestShipmentDate(heldDeliveryDate, today);',
    );
    expect(FORM).toMatch(/min=\{earliestDeliveryDate\}\s+value=\{deliveryDate\}/u);
    expect(FORM).toContain(
      "shipmentType === 'secured' ? shipmentDateProblem(deliveryDate, heldDeliveryDate, day) : null",
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
