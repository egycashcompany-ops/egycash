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
