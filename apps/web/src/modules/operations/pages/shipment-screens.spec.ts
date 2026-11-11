// What each shipments screen IS and what may be done from it — read from the pages and the shared
// board's source, because the board needs a browser and a server to render, and these are the lines
// a refactor could quietly undo.
//
//   · «اليوم التشغيلي دى هنشيل منها التاريخ … هو هيجيب بتاعت اليوم»: the day board is today's,
//     Cairo's today, with no day picker;
//   · «الصفحة اللى هتتكرر بقى هتكون هى هى بس طبعا مش هيقدر يضيف … ومش هيقدر منها يسلم او يستلم»:
//     the history is the same board without «إضافة شحنة» and without the ✓ — but «عاوز عادى يعدل
//     و يحذف»: edit and delete stay, and so does the receipt image;
//   · «هيكون فى سجل بالاكشنز اللى حصلت على الشحنة» on BOTH screens: «السجل» on every row;
//   · «اللى اتمسح اعملى ايقون اقدر اجيب منه اللى اتمسح»: the deleted shipments' icon, on the
//     history only.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const BOARD = read('../components/ShipmentsBoard.tsx');
const DAY_PAGE = read('./DailyOperationsPage.tsx');
const HISTORY_PAGE = read('./ShipmentsHistoryPage.tsx');
const TODAY_HOOK = read('../lib/use-cairo-today.ts');
const DELETED = read('../components/DeletedShipments.tsx');
const QUERIES = read('../api/operations-queries.ts');

/** The row actions' cell, from its key to the next column — the edit, the ✓ and the delete. */
const ACTIONS = BOARD.slice(
  BOARD.indexOf("key: 'actions',"),
  BOARD.indexOf('];', BOARD.indexOf("key: 'actions',")),
);

describe('«هنشيل منها التاريخ» — the day board is today’s', () => {
  it('asks the server for Cairo’s today by name, not for "whatever today is" there', () => {
    // An empty `?date=` is resolved by the server as the UTC day, which lags Cairo for the first
    // two or three hours after midnight — the desk would open on yesterday.
    expect(DAY_PAGE).toContain('const today = useCairoToday();');
    expect(DAY_PAGE).toContain('useOperationsDayBoard(today)');
    expect(TODAY_HOOK).toContain('const today = cairoToday();');
  });

  it('never reads a day from the URL, and drops an old link’s `?date=`', () => {
    expect(DAY_PAGE).not.toContain("sp.get('date')");
    expect(DAY_PAGE).toContain("next.delete('date');");
    expect(DAY_PAGE).toContain('setSp(next, { replace: true });');
  });

  it('has no day picker, and no period for a reset to undo', () => {
    expect(DAY_PAGE).not.toContain('datePickers');
    expect(DAY_PAGE).not.toContain('periodActive');
    expect(DAY_PAGE).not.toContain('dailyOps.date');
  });

  it('moves to the new day by itself on a screen left open over midnight', () => {
    // Today is read per render; one timer for the next Cairo midnight, and a look when the tab
    // comes back (a sleeping laptop runs that timer late) make sure a render happens.
    expect(TODAY_HOOK).toContain('msUntilNextCairoDay()');
    expect(TODAY_HOOK).toContain("addEventListener('visibilitychange'");
    expect(TODAY_HOOK).toContain('window.clearTimeout(timer);');
    expect(TODAY_HOOK).toContain('}, [today]);');
  });
});

describe('«مش هيقدر يضيف … ومش هيقدر منها يسلم او يستلم» — what each screen offers', () => {
  it('the board offers «إضافة شحنة» only where the page allows it, and to whom may create', () => {
    expect(BOARD).toContain("const canAdd = canCreate && can('operationsShipment.create');");
    expect(BOARD).toMatch(/\{canAdd && \(\s*<button[^>]*?\s+data-shipment-new="true"/);
    // The form cannot be opened to create from a screen that does not offer it.
    expect(BOARD).toContain('open={(canAdd && creating) || editing !== null}');
  });

  it('the board offers the ✓ (deliver / undo) only where the page allows it', () => {
    expect(BOARD).toContain(
      "const canComplete = canToggleReceived && can('operationsShipment.complete');",
    );
    expect(ACTIONS).toMatch(/\{canComplete && \(\s*<button[\s\S]*?toggleReceived\(row\)/);
  });

  it('the day board keeps both — new shipments are entered and delivered there', () => {
    expect(DAY_PAGE).toMatch(/^\s+canCreate$/m);
    expect(DAY_PAGE).toMatch(/^\s+canToggleReceived$/m);
  });

  it('the history offers neither', () => {
    expect(HISTORY_PAGE).toContain('canCreate={false}');
    expect(HISTORY_PAGE).toContain('canToggleReceived={false}');
  });

  it('«عاوز عادى يعدل و يحذف» — edit, delete and the receipt image are offered on both screens', () => {
    // Gated by the permission alone — never by what the page allows.
    expect(BOARD).toContain("const canEdit = can('operationsShipment.edit');");
    expect(BOARD).toContain("const canDelete = can('operationsShipment.delete');");
    expect(ACTIONS).toMatch(/\{canEdit && \(\s*<button[\s\S]*?setEditing\(row\)/);
    expect(ACTIONS).toMatch(/\{canDelete && \(\s*<button[\s\S]*?removeShipment\(row\)/);
    expect(BOARD).toContain(
      'render: (row) => <ShipmentReceiptImageCell row={row} onPreview={setPreviewingReceipt} />',
    );
  });

  it('both are required of a page — a new screen decides, rather than inheriting a default', () => {
    expect(BOARD).toMatch(/^\s+canCreate: boolean;$/m);
    expect(BOARD).toMatch(/^\s+canToggleReceived: boolean;$/m);
  });
});

describe('«سجل بالاكشنز اللى حصلت على الشحنة» — the log on both screens', () => {
  it('is a row action of the shared board, for whoever may see the rows — on both screens', () => {
    // Gated by the read grant alone, never by what the page allows (`canCreate`, …).
    expect(BOARD).toContain("const canViewLog = can('operationsShipment.view');");
    expect(ACTIONS).toMatch(/\{canViewLog && \(\s*<button[\s\S]*?setLogOf\(/);
    expect(ACTIONS).toContain("className={actionTone('history')}");
    expect(ACTIONS).toContain("aria-label={t('operations.shipment.log.open')}");
    expect(BOARD).toContain('<ShipmentLogDialog target={logOf} onClose={() => setLogOf(null)} />');
  });

  it('sits between the ✓ and the bin, as the row-actions picture orders a log', () => {
    expect(ACTIONS.indexOf('{canComplete &&')).toBeLessThan(ACTIONS.indexOf('{canViewLog &&'));
    expect(ACTIONS.indexOf('{canViewLog &&')).toBeLessThan(ACTIONS.indexOf('{canDelete &&'));
  });
});

describe('«اعملى ايقون اقدر اجيب منه اللى اتمسح» — the deleted shipments, on the history', () => {
  it('the board shows the icon only where the page hands it a range', () => {
    expect(BOARD).toMatch(/\{deletedShipments !== undefined && \(\s*<DeletedShipmentsControl/);
    expect(BOARD).toMatch(/^\s+deletedShipments\?: \{ range: HistoryRange; enabled: boolean \};$/m);
  });

  it('the history hands in its own range, asked for only when the range itself may be', () => {
    expect(HISTORY_PAGE).toContain('deletedShipments={{ range, enabled: problem === null }}');
  });

  it('the day board has none', () => {
    expect(DAY_PAGE).not.toContain('deletedShipments');
  });

  it('brings one back only for whoever may delete — the grant that takes it off', () => {
    expect(DELETED).toContain("const canRestore = can('operationsShipment.delete');");
    expect(DELETED).toMatch(/\{canRestore && \(\s*<button[\s\S]*?data-deleted-restore=/);
    // Confirmed first, as the delete is.
    expect(DELETED).toMatch(
      /if \(!window\.confirm\(t\('operations\.shipment\.deletedList\.confirmRestore'\)\)\) return;/,
    );
  });

  it('a restore refreshes the deleted list, the history and the day board — even when refused', () => {
    const hook = QUERIES.slice(QUERIES.indexOf('export const useRestoreOperationsShipment'));
    expect(hook).toMatch(
      /const invalidate = useShipmentInvalidation\(\);[\s\S]*?onSettled: invalidate,/,
    );
  });
});
