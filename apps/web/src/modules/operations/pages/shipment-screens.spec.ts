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
//     history only;
//   · «شاشة الشحنات المحصنة عاوز شكلها يكون زى شاشة اليوم التشغيلى بس هنزود التاريخ التسليم يظهر فى
//     الجدول والحالة»: the secured screen is the same board, with a delivery-date column, the
//     محصنة's stage as its status, and «إضافة محصنة» — but no ✓;
//   · «اليوم التشغيلى هيظهر فيها اليومى والمحصنة»: a محصنة on the day board, whatever its stage, is
//     coloured and worded by its stage, and takes the ✓ only once it has left the vault;
//   · Round 10 — «فى شاشة المحصنات ممكن القائد اللى يعمل صح انه استلم او العمليات»: the secured screen
//     has the desk's PICKUP ✓ and its undo; «ميقدر حد … يعدل عليها»: a محصنة the vault has received is
//     locked on every board; «بس صلاحية خاصة تقدر تلغى استلام الخزينة»: the cancelled receipt.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const BOARD = read('../components/ShipmentsBoard.tsx');
const DAY_PAGE = read('./DailyOperationsPage.tsx');
const HISTORY_PAGE = read('./ShipmentsHistoryPage.tsx');
const SECURED_PAGE = read('./SecuredBacklogPage.tsx');
const TODAY_HOOK = read('../lib/use-cairo-today.ts');
const DELETED = read('../components/DeletedShipments.tsx');
const QUERIES = read('../api/operations-queries.ts');
const RECEIPT_CELL = read('../components/ShipmentReceiptImageCell.tsx');

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
    expect(ACTIONS).toMatch(
      /\{canComplete && offersDeliveryToggle\(row\) && \(\s*<button[\s\S]*?toggleReceived\(row\)/,
    );
  });

  // The server completes a محصنة only from `dispatched` and reopens it only from `completed`
  // (`offersDeliveryToggle`, pinned in secured-stage.spec): on the day board a محصنة still on its
  // way to the vault, or in it, shows no ✓ — and keeps the ✓'s square, empty, so the log and the
  // bin do not jump sideways between rows.
  it('offers the ✓ on a row only where the server takes it — the square kept, empty, elsewhere', () => {
    expect(ACTIONS).toMatch(
      /\{canComplete && !offersDeliveryToggle\(row\) && \(\s*<span aria-hidden className=\{cn\(actionTone\('status'\), 'invisible'\)\} \/>/,
    );
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
    // Gated by the permission — and turned off only by a screen that says so (`canEditRows`, on
    // by default): the vault's receive queue, where the treasury receives and does not edit.
    expect(BOARD).toContain("const canEdit = canEditRows && can('operationsShipment.edit');");
    expect(BOARD).toContain("const canDelete = canEditRows && can('operationsShipment.delete');");
    expect(BOARD).toContain('canEditRows = true,');
    for (const page of [DAY_PAGE, HISTORY_PAGE, SECURED_PAGE]) {
      expect(page).not.toContain('canEditRows');
    }
    // …on a row that is not locked (Round 10, pinned below).
    expect(ACTIONS).toMatch(/\{canEdit && !locked && \(\s*<button[\s\S]*?setEditing\(row\)/);
    expect(ACTIONS).toMatch(/\{canDelete && !locked && \(\s*<button[\s\S]*?removeShipment\(row\)/);
    expect(BOARD).toMatch(
      /<ShipmentReceiptImageCell\s+row=\{row\}\s+onPreview=\{setPreviewingReceipt\}\s+readOnly=\{!canEditRows\}\s+\/>/,
    );
  });

  it('the secured screen adds secured shipments — and offers no ✓', () => {
    expect(SECURED_PAGE).toMatch(/^\s+canCreate$/m);
    expect(SECURED_PAGE).toContain('createType="secured"');
    expect(SECURED_PAGE).toContain('canToggleReceived={false}');
    // «إضافة محصنة», not «إضافة شحنة», on its button.
    expect(BOARD).toMatch(
      /createType === 'secured'\s+\? 'operations\.secured\.backlog\.add'\s+: 'operations\.shipment\.add'/,
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

// «شاشة الاستلام من الخزنة خليها زى شاشة التشغيل اليومى» made the vault's queue a fourth user of the
// board. What it adds comes through hooks the other three screens never touch, so none of them
// changes by its arrival; vault-receive.spec pins what the vault page hands in.
describe('the board’s page hooks — the vault queue’s, and no other screen’s', () => {
  it('draws a page’s own row act at the ✓’s place, before the log', () => {
    expect(ACTIONS).toContain('const own = rowAction?.(row) ?? null;');
    // One square for the row's act: the page's own, or the board's (Round 10: the pickup ✓, the
    // cancelled receipt) — together, never two squares.
    expect(ACTIONS).toContain('const securedAct = securedActOf(row);');
    expect(ACTIONS).toMatch(
      /const act =\s*own === null && securedAct === null \? null : \(\s*<>\s*\{own\}\s*\{securedAct\}\s*<\/>/,
    );
    expect(BOARD).toContain(
      'const offersRowAct = rowAction !== undefined || canPickup || canCancel;',
    );
    const own = ACTIONS.indexOf('{offersRowAct &&');
    expect(own).toBeGreaterThan(-1);
    expect(ACTIONS.indexOf('{canComplete && !offersDeliveryToggle(row)')).toBeLessThan(own);
    expect(own).toBeLessThan(ACTIONS.indexOf('{canViewLog &&'));
    // A row with no act keeps the act's square, empty, while the log or the bin follow.
    expect(ACTIONS).toMatch(
      /\(act \?\?\s*\(\(canViewLog \|\| canDelete\) && \(\s*<span aria-hidden className=\{cn\(actionTone\('status'\), 'invisible'\)\} \/>/,
    );
  });

  it('draws a dash, not an empty box, on a row with nothing to do', () => {
    expect(ACTIONS).toContain(
      'if (!canEdit && !canComplete && !canViewLog && !canDelete && act === null) return DASH;',
    );
  });

  it('draws no actions column for a reader the screen offers nothing to do on a row', () => {
    expect(BOARD).toContain(
      'const offersRowActions = canEdit || canComplete || canViewLog || canDelete || offersRowAct;',
    );
    expect(BOARD).toMatch(
      /const columns = offersRowActions\s+\? boardColumns\s+: boardColumns\.filter\(\(column\) => column\.key !== 'actions'\);/,
    );
  });

  it('puts a page’s toolbar controls where the day board has «إضافة شحنة», over the rows shown', () => {
    const toolbar = BOARD.slice(BOARD.indexOf('data-shipment-stats-toggle'));
    expect(toolbar).toContain('{toolbarExtras?.(rows)}');
    expect(toolbar.indexOf('{toolbarExtras?.(rows)}')).toBeLessThan(
      toolbar.indexOf('data-shipment-new'),
    );
  });

  it('leaves the three Operations boards as they were', () => {
    for (const page of [DAY_PAGE, HISTORY_PAGE, SECURED_PAGE]) {
      for (const hook of ['rowAction', 'statusNote', 'toolbarExtras', 'stages=']) {
        expect(page).not.toContain(hook);
      }
    }
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

describe('«شاشة الشحنات المحصنة … زى شاشة اليوم التشغيلى» — the secured screen', () => {
  it('is drawn by the shared board, not a table of its own', () => {
    expect(SECURED_PAGE).toContain('<ShipmentsBoard');
    expect(SECURED_PAGE).not.toContain('<DataTable');
    expect(SECURED_PAGE).not.toContain('<Pagination');
  });

  it('reads every open محصنة as board rows from the server — the backlog, no date', () => {
    expect(SECURED_PAGE).toContain('const board = useOperationsSecuredBoard();');
    expect(SECURED_PAGE).not.toContain('useSecuredBacklog');
    expect(SECURED_PAGE).not.toContain('datePickers');
    expect(QUERIES).toContain(
      "const securedBoardKey = (): readonly unknown[] => [...featureKey(MODULE, 'dayBoard'), 'secured'];",
    );
    expect(QUERIES).toContain('queryFn: () => api.getSecuredBoard(),');
  });

  it('«هنزود التاريخ التسليم يظهر فى الجدول» — a delivery-date column, and the date named for what it is', () => {
    expect(SECURED_PAGE).toContain('kind="secured"');
    expect(BOARD).toContain("const secured = kind === 'secured';");
    expect(BOARD).toContain(
      "header: t(secured ? 'operations.board.collectedOn' : 'operations.board.date'),",
    );
    expect(BOARD).toContain("header: t('operations.shipment.deliveryDate'),");
    // The delivery date is the secured screen's column; «النوع» everyone else's — every row on the
    // secured screen is a محصنة, and the type's width is what the extra date needs at 1440.
    expect(BOARD).toMatch(
      /everyColumn\.filter\(\s*\(column\) =>\s*column\.key !== \(secured \? 'type' : 'deliveryDate'\) &&/,
    );
    // Neither of the other two screens is that board.
    expect(DAY_PAGE).not.toContain('kind=');
    expect(HISTORY_PAGE).not.toContain('kind=');
  });

  it('«والحالة …» — the status is the محصنة’s stage, and so is the filter', () => {
    // `shownStage` (secured-stage.spec) is the stage, or null where the cell says who delivered —
    // a daily row, and a محصنة on the road its delivery captain has delivered.
    expect(BOARD).toMatch(
      /const stage = shownStage\(row\);\s*const badge =\s*stage !== null \? \(\s*<SecuredStageBadge stage=\{stage\} \/>\s*\) : \(\s*<DeliveryStatusBadge delivery=\{boardDelivery\(row\)\} \/>/,
    );
    // A page may add a line under the badge (the vault queue's "when"); the badge is the same.
    expect(BOARD).toContain('const note = statusNote?.(row);');
    // The stage box is the secured board's status filter (day-board-filters.spec pins the bar).
    expect(BOARD).toMatch(/\{secured \? \(\s*<FilterWithIcon/);
  });

  // «لما القائد هيستلم … هيبقى الصف باللون الاصفر … ولما الخزنة تدوس صح ساعتها هتبقى اخضر عند الخزنة
  // وعند العمليات» — the same colours on every board.
  it('colours every board’s rows by the one rule — a محصنة by its stage, a daily row by who delivered', () => {
    expect(BOARD).toContain(
      'rowClassName={(row) => (tintOf === undefined ? boardRowTint(row) : tintOf(row))}',
    );
    expect(BOARD).not.toContain('rowTint(boardDelivery(row))');
    // A rule of its own is the vault queue's alone (its green stays green once a row has left);
    // none of the three Operations boards hands one in.
    for (const page of [DAY_PAGE, HISTORY_PAGE, SECURED_PAGE]) {
      expect(page).not.toContain('tintOf');
    }
  });

  it('cuts its open list into pages, and says a refusal in the table’s place', () => {
    expect(SECURED_PAGE).toMatch(/^\s+paged$/m);
    expect(SECURED_PAGE).toContain('const tooLarge = isHistoryTooLarge(board.error);');
    expect(SECURED_PAGE).toContain('refusal={refusal}');
    // The refusal replaces the rows and the figures together, as on the history.
    expect(SECURED_PAGE).toContain('shipments={tooLarge ? [] : (board.data?.shipments ?? [])}');
    expect(SECURED_PAGE).toContain('loaded={!tooLarge && board.data !== undefined}');
  });

  it('has no deleted-shipments icon — that is the history’s', () => {
    expect(SECURED_PAGE).not.toContain('deletedShipments');
  });
});

// ── Round 10 ─────────────────────────────────────────────────────────────────────────────────────
describe('«ممكن القائد اللى يعمل صح انه استلم او العمليات» — the desk’s pickup ✓, the secured screen’s', () => {
  it('is offered where the page turns it on, to whoever holds the desk’s ✓ grant', () => {
    expect(BOARD).toContain('canConfirmPickup = false,');
    expect(BOARD).toContain(
      "const canPickup = canConfirmPickup && can('operationsShipment.complete');",
    );
    expect(SECURED_PAGE).toMatch(/^\s+canConfirmPickup$/m);
    for (const page of [DAY_PAGE, HISTORY_PAGE]) expect(page).not.toContain('canConfirmPickup');
  });

  it('is a toggle at the ✓’s place — pressed once somebody collected it — read from the row', () => {
    const act = BOARD.slice(
      BOARD.indexOf('const securedActOf'),
      BOARD.indexOf('const removeShipment'),
    );
    expect(act).toContain('const toggle = canPickup ? pickupToggleOf(row) : null;');
    expect(act).toContain("const pressed = toggle === 'undo';");
    expect(act).toContain("className={cn(actionTone('status'), pressed && PRESSED)}");
    expect(act).toContain('aria-pressed={pressed}');
    expect(act).toContain("aria-label={t('operations.secured.pickup.toggle')}");
    expect(act).toContain('onClick={() => togglePickup(row)}');
  });

  // «لو القائد عمل صح ممكن العمليات تشيلها»: the desk takes the captain's ✓ back too — his act, so
  // it is confirmed first; the desk's own toggles back as the day board's ✓ does.
  it('confirms before taking back the CAPTAIN’s ✓, and sends the version it was read at', () => {
    const toggle = BOARD.slice(
      BOARD.indexOf('const togglePickup'),
      BOARD.indexOf('const securedActOf'),
    );
    expect(toggle).toMatch(
      /undo &&\s*row\.pickedUpBy === 'captain' &&\s*!window\.confirm\(t\('operations\.secured\.pickup\.confirmUndoCaptain'\)\)/,
    );
    expect(toggle).toContain(
      'setPickup.mutate({ id: row.id, pickedUp: !undo, body: { version: row.version } });',
    );
  });

  it('re-reads every board on success and refusal alike — the secured acts’ invalidation', () => {
    const hook = QUERIES.slice(QUERIES.indexOf('export const useSetSecuredPickup'));
    expect(hook).toMatch(
      /const invalidate = useSecuredInvalidation\(\);[\s\S]*?onSettled: invalidate,/,
    );
    expect(hook.slice(0, hook.indexOf('});'))).toContain(
      '(pickedUp ? api.confirmSecuredPickup(id, body) : api.undoSecuredPickup(id, body))',
    );
  });
});

describe('«ميقدر حد … يعدل عليها» — a محصنة the vault has received is locked, on every board', () => {
  it('offers no edit and no delete on a locked row — a lock in the pen’s place, the bin’s kept empty', () => {
    expect(ACTIONS).toContain('const locked = isLockedRow(row);');
    expect(ACTIONS).toMatch(
      /\{canEdit && locked && \(\s*<span\s+data-row-locked=\{row\.id\}\s+title=\{t\('operations\.board\.locked'\)\}/,
    );
    expect(ACTIONS).toMatch(
      /\{canDelete && locked && \(\s*<span aria-hidden className=\{cn\(actionTone\('delete'\), 'invisible'\)\} \/>/,
    );
  });

  it('offers no receipt-photo upload, replace or delete on a locked row — the eye stays', () => {
    expect(RECEIPT_CELL).toContain(
      "const mayEdit = !readOnly && !isLockedRow(row) && can('operationsShipment.edit');",
    );
    expect(RECEIPT_CELL).toMatch(
      /const mayDelete =\s*!readOnly && row !== null && !isLockedRow\(row\) && can\('operationsShipment\.edit'\);/,
    );
    // The eye is the read grant's alone.
    expect(RECEIPT_CELL).toContain("const mayView = can('operationsShipment.view');");
  });

  it('closes a form opened before the vault’s ✓ on its refusal, over a re-read board', () => {
    const update = QUERIES.slice(QUERIES.indexOf('export const useUpdateOperationsShipment'));
    expect(update.slice(0, update.indexOf('\n};'))).toContain(
      'if (isLockedRefusal(error)) void invalidate();',
    );
  });
});

describe('«بس صلاحية خاصة تقدر تلغى استلام الخزينة» — the cancelled receipt', () => {
  it('is offered where the page turns it on — the secured screen and the vault’s — to its grant alone', () => {
    expect(BOARD).toContain('canCancelReceipt = false,');
    expect(BOARD).toContain(
      "const canCancel = canCancelReceipt && can('operationsVault.cancelReceipt');",
    );
    expect(SECURED_PAGE).toMatch(/^\s+canCancelReceipt$/m);
    for (const page of [DAY_PAGE, HISTORY_PAGE]) expect(page).not.toContain('canCancelReceipt');
  });

  it('opens its dialog from a row in the vault, at the ✓’s place', () => {
    const act = BOARD.slice(
      BOARD.indexOf('const securedActOf'),
      BOARD.indexOf('const removeShipment'),
    );
    expect(act).toMatch(
      /if \(canCancel && offersReceiptCancel\(row\)\) \{[\s\S]*?setCancelling\(\{ row, caption: shipmentCaption\(row, bankNameOf, t\) \}\)/,
    );
    expect(BOARD).toMatch(
      /\{canCancel && \(\s*<CancelVaultReceiptDialog target=\{cancelling\} onClose=\{\(\) => setCancelling\(null\)\} \/>/,
    );
  });
});

describe('«صرف الخزينة» on this board — what a page that hosts the release can hand it', () => {
  it('draws the ticks’ column only for a page that hands in a selection, first in the row', () => {
    expect(BOARD).toContain("(column.key !== 'select' || selection !== undefined),");
    expect(BOARD).toMatch(/^\s+selection\?: BoardSelection<T>;$/m);
    for (const page of [DAY_PAGE, HISTORY_PAGE, SECURED_PAGE])
      expect(page).not.toContain('selection=');
  });

  it('reads every محصنة in the vault inside the day board’s subtree, its day left out when none', () => {
    expect(QUERIES).toContain("...featureKey(MODULE, 'dayBoard'),\n  'securedDispatch',");
    expect(QUERIES).toContain(
      "queryFn: () => api.getSecuredDispatchBoard(date === '' ? null : date),",
    );
  });
});
