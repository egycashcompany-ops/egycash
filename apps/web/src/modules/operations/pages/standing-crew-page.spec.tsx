// Round 27 — «الطاقم الثابت» in «لوحة التشغيلة»'s look. The owner: «عاوزك تخلى شاشة الطاقم الثابت نفس
// شكل لوحة التشغيل بقى فاهم».
//
// What a typecheck cannot see:
//   • the page is BUILT FROM the board's pieces — the frame (`CrewPlanFrame`), the slot
//     (`CrewPlanSlot`), the chips and the pools, the slot's list, the board's list of cars — and the
//     board itself draws its toolbar's start, its count chips, its grid and its «إخراج …» from the
//     same frame, so the two cannot drift apart;
//   • the hands are the board's: Round 22's drop (who is dragged kept in a ref, the whole frame
//     accepting, the drop deciding), a slot's list, «ضع هنا», the person's card, Round 23's refusal,
//     «تراجع» one step at a time, the filters; the old per-box `getData` drop and the bare <select>
//     are gone;
//   • what stays the list's own: no day, no notes, no type; no absence or leave (a day's fact) on its
//     chips, cards or drops; the van's card without the day's drivers; the save's body unchanged;
//   • every new word in Arabic and English.
//
// The suite runs in node with no DOM: the pieces are rendered on their own, the page is read as
// source (as the board's own specs read it).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type Locale,
  type MeDto,
  type OperationsCrewMemberDto,
  type OperationsDayBoardVehicleCrewDto,
} from '@ecms/contracts';
import type { ReactNode } from 'react';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { PLURAL_FORMS } from '../../../shared/lib/plural';
import { translate } from '../../../platform/localization/i18n';
import { VehicleCrewCardBody } from '../components/BoardCrewCards';
import { PlanAttendanceFact, PlanMemberCardBody } from '../components/CrewPlanMemberCard';
import { CrewPlanHand, FilteredCount, ReturnPickedButton } from '../components/CrewPlanFrame';
import { CrewPlanSlot } from '../components/CrewPlanSlot';
import {
  CrewPlanScopeProvider,
  STANDING_WORD_KEYS,
  scopedKey,
  showsDayFacts,
} from '../components/crew-plan-scope';
import { resolveDrop, type DropDecision, type DropTarget } from '../lib/crew-drag';
import { type PlanRow } from '../lib/crew-plan';
import { STANDING_CREW_STATES } from '../lib/standing-crew';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const PAGE = read('./StandingCrewPage.tsx');
const BOARD = read('./CrewBoardPage.tsx');

const render = (node: ReactNode, locale: Locale = 'ar'): string =>
  renderToStaticMarkup(
    <Provider
      store={configureStore({
        reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
        preloadedState: {
          locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
          auth: {
            me: {
              id: 'u1',
              permissions: {
                'operationsCrew.view': 'organization',
                'operationsCrew.plan': 'organization',
              },
            } as unknown as MeDto,
            status: 'signedIn' as const,
          },
        },
      })}
    >
      <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
    </Provider>,
  );
const standing = (node: ReactNode): ReactNode => (
  <CrewPlanScopeProvider value="standing">{node}</CrewPlanScopeProvider>
);
const t = (key: string, vars?: Record<string, string>, locale: Locale = 'ar'): string =>
  translate(locale, key, vars);
const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const CAPTAIN: OperationsCrewMemberDto = {
  employeeId: 'e-cap',
  code: '0100007',
  fullNameAr: 'احمد سيد بركة محمد',
  status: 'active',
  jobTitle: null,
  phone: null,
  branchId: null,
  requirements: {
    id: 'r',
    employeeId: 'e-cap',
    isCaptain: true,
    isSpecialist: false,
    hasWeapon: true,
    hasSignature: false,
    hasLicense: false,
    hasTemporaryLicense: false,
    isOpsAdmin: false,
    isNewJoiner: false,
    isAssignedSpecialTask: false,
    isPriority: false,
    notes: null,
    version: 1,
    createdAt: '',
    updatedAt: '',
  },
  assignedVehicleId: null,
  availability: null,
};

// ── The pieces: the board's, shared ──────────────────────────────────────────────────────────────

describe('Round 27 — the page is built from the board’s own pieces', () => {
  it('draws the board’s frame, toolbar, bar, grid, slots, chips, pools and lists', () => {
    for (const piece of [
      'className={BOARD_FRAME} data-crew-plan="true" data-standing-crew="true"',
      '<CrewPlanHand',
      'className={CREW_PLAN_BAR} data-crew-plan-bar="true"',
      'className={CREW_PLAN_GRID} data-crew-plan-grid="true"',
      'className={CREW_PLAN_POOLS}',
      'className={CREW_PLAN_TABLE_SIDE}',
      '<CrewPlanPool',
      '<CrewPlanSlot',
      '<CrewSlotPicker',
      '<CrewVehiclePicker',
      '<CrewVehicleHoverCode',
      '<DirectionPicker',
      '<TimePicker',
      '<FilteredCount',
      '<ReturnPickedButton',
      '<CrewRosterNotice',
      '<DataTable',
      'stickyHead',
    ]) {
      expect(PAGE, piece).toContain(piece);
    }
    // The board itself draws the same frame pieces — one source, so the two cannot drift.
    for (const piece of [
      'className={CREW_PLAN_BAR} data-crew-plan-bar="true"',
      'className={CREW_PLAN_GRID} data-crew-plan-grid="true"',
      '<CrewPlanHand',
      '<FilteredCount',
      '<ReturnPickedButton',
      'CREW_PLAN_TABLE,',
    ]) {
      expect(BOARD, piece).toContain(piece);
    }
    expect(read('../components/CrewPlanFrame.tsx')).toContain('export const targetAt =');
    expect(BOARD).not.toContain('const targetAt =');
  });

  it('tells every shared piece it is on the standing crew', () => {
    expect(PAGE).toContain('<CrewPlanScopeProvider value="standing">');
  });

  it('keeps the board’s buttons and their look: the board link, «إضافة سيارة», Excel, «تراجع», «حفظ (n)»', () => {
    const acts = PAGE.slice(
      PAGE.indexOf('data-standing-to-board="true"'),
      PAGE.indexOf('data-crew-plan-bar="true"'),
    );
    const order = [
      'data-standing-to-board',
      'data-standing-add',
      'data-crew-plan-excel',
      'data-crew-plan-undo',
      'data-crew-plan-save',
    ].map((mark) => acts.indexOf(mark));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(acts).toContain('dirty ? ADD_BUTTON : BRAND_BUTTON');
    expect(acts).toContain("t('operations.crewPlan.saveCount', {");
    expect(acts).toContain("t('operations.crewPlan.discard')");
  });
});

// ── The hands: the board's ───────────────────────────────────────────────────────────────────────

describe('Round 27 — the board’s hands', () => {
  it('drops by Round 22’s rule: who is dragged in a ref, the whole frame accepting, the drop deciding', () => {
    expect(PAGE).toContain('const dragRef = useRef<string | null>(null);');
    const start = PAGE.slice(PAGE.indexOf('const startDrag = '), PAGE.indexOf('const drawDrag = '));
    expect(start).toContain('beginDrag(event.dataTransfer, employeeId);');
    expect(start).not.toMatch(/\bset[A-Z]\w*\(/u);
    const over = PAGE.slice(PAGE.indexOf('const overDrag = '), PAGE.indexOf('const frameDrop'));
    expect(over).toContain(
      'if (!acceptsDragOver(employeeId)) return;\n    event.preventDefault();',
    );
    expect(over).not.toContain('decide(');
    const drop = PAGE.slice(PAGE.indexOf('onDrop: (event) => {'), PAGE.indexOf(': {};'));
    expect(drop).toContain('droppedMember({ own, custom, text }, onBoard)');
    expect(drop).toContain('decide(targetAt(event.target), employeeId)');
    expect(drop).toContain(
      "if (decision.kind === 'place') place(decision.key, decision.slot, employeeId);",
    );
    expect(drop).toContain("else if (decision.kind === 'free') free(employeeId);");
    expect(drop).toContain(
      "else if (decision.kind === 'refuse') sayRefusal(decision, employeeId);",
    );
    // The fragile pattern Round 22 took off the board: no box reads the drag on its own, no
    // `types`, no dropEffect.
    expect(PAGE.match(/getData\(CREW_DRAG_TYPE\)/gu)).toHaveLength(1);
    expect(PAGE).not.toMatch(/dataTransfer\.types/u);
    expect(PAGE).not.toMatch(/dropEffect\s*=/u);
    expect(PAGE).not.toContain('CrewMemberCard');
    expect(PAGE).not.toContain('<CrewPools');
  });

  it('picks from a slot’s list through the drop’s own rule, and keeps «ضع هنا»', () => {
    const pickInto = PAGE.slice(PAGE.indexOf('const pickInto ='), PAGE.indexOf('const settleDrag'));
    expect(pickInto).toContain("decide({ kind: 'slot', key, slot }, employeeId)");
    expect(pickInto).toContain('sayRefusal(decision, employeeId)');
    expect(pickInto).toContain('place(key, slot, employeeId)');
    expect(PAGE).toContain('onOpenList={(from) => openPicker(row.key, slot, from)}');
    expect(PAGE).toContain('onPlace={(employeeId) => place(row.key, slot, employeeId)}');
    expect(PAGE.match(/<CrewSlotPicker\b/gu)).toHaveLength(1);
    expect(PAGE).toContain('sheet={phone}');
  });

  it('takes back ONE operation a press — the button, Ctrl+Z, and nothing while «حفظ» is in flight', () => {
    expect(PAGE).toContain('const lastOperation = undoableStep(history, saving);');
    expect(PAGE).toContain('onClick={undoLast}');
    expect(PAGE).toContain('disabled={lastOperation === null}');
    expect(PAGE).toContain('setHistory(undo);');
    expect(PAGE).toContain("event.code !== 'KeyZ'");
    expect(PAGE).toContain('aria-keyshortcuts="Control+Z Meta+Z"');
    expect(PAGE).toContain('setHistory((current) => startHistory(current.now));');
    // The time panel's hour and minute are one operation, until it closes.
    expect(PAGE).toContain('onSettle={() => setHistory(sealHistory)}');
    // Every kind the page records is said, in both languages.
    const kinds = [...PAGE.matchAll(/kind: '([a-zA-Z]+)', vars/gu)].map(
      (match) => match[1] as string,
    );
    expect(new Set(kinds)).toEqual(
      new Set(['moveCrew', 'place', 'free', 'removeVehicle', 'addVehicle']),
    );
    for (const kind of [...kinds, 'direction', 'time']) {
      for (const locale of ['ar', 'en'] as const) {
        const key = `operations.standingCrew.undo.${kind}`;
        expect(translate(locale, key), key).not.toBe(key);
      }
    }
  });

  it('takes a vehicle out with the board’s bin, a step of the draft — no confirm, no instant DELETE', () => {
    expect(PAGE).toContain('discardRow(current, row.key)');
    expect(PAGE).not.toContain('window.confirm');
    expect(PAGE).toContain("t('operations.standingCrew.removeVehicle', { code: rowName(row) })");
  });

  it('adds a vehicle from the board’s list of cars, not a bare <select>', () => {
    expect(PAGE).not.toMatch(/<Select\b/u);
    expect(PAGE).toContain('standingVehicleChoices(');
    expect(PAGE).toContain('const row = newStandingPlanRow(choice, serverRows);');
    // A new vehicle has nobody yet: every filter would hide it.
    const add = PAGE.slice(PAGE.indexOf('const addVehicle ='), PAGE.indexOf('// ── «تراجع»'));
    expect(add).toContain('clearFilters();');
  });

  it('filters the table by the vehicle, a person and the direction — view only', () => {
    const bar = PAGE.slice(PAGE.indexOf('data-crew-plan-bar="true"'));
    const at = (needle: string): number => bar.indexOf(needle);
    expect(at('data-standing-dayless')).toBeLessThan(at("t('operations.crewPlan.filter.van')"));
    expect(at("t('operations.crewPlan.filter.van')")).toBeLessThan(
      at("t('operations.crewPlan.filter.person')"),
    );
    expect(at("t('operations.crewPlan.filter.person')")).toBeLessThan(
      at("t('operations.crewPlan.filter.direction')"),
    );
    // The save is built from every row; the table from the filtered ones.
    expect(PAGE).toContain('const pending = standingSave(rows, serverRows);');
    expect(PAGE).toContain('rows={shown as PlanRow[]}');
  });

  it('saves the vehicles taken out first, then the changed rows in one PUT with the same body', () => {
    const save = PAGE.slice(PAGE.indexOf('const save = async'), PAGE.indexOf('const exportExcel'));
    expect(save.indexOf('removeStanding.mutateAsync(vehicleId)')).toBeLessThan(
      save.indexOf('putStanding.mutateAsync({ rows: put })'),
    );
    expect(save).toContain("failure.code === 'OPERATIONS_CREW_MEMBER_WRONG_SLOT'");
    expect(read('../lib/standing-crew.ts')).toContain('const put = toStandingPayloadRows(');
  });

  // Round 27 verification: a vehicle another desk took out first answered 404 and stopped «حفظ» on
  // every press — the rest of the draft could not be saved. The order and the 404 rule are
  // `sendStandingSave`'s (tested in lib/standing-crew.spec.ts); here, that the page goes through it,
  // re-reads the list when a vehicle was already gone, and owns the DELETE's error (one toast).
  it('a vehicle already taken out at another desk does not stop «حفظ»', () => {
    const save = PAGE.slice(PAGE.indexOf('const save = async'), PAGE.indexOf('const exportExcel'));
    expect(save).toContain('await sendStandingSave(');
    expect(save).toContain('if (outcome.alreadyGone.length > 0) await standing.refetch();');
    expect(save.indexOf('await standing.refetch()')).toBeLessThan(
      save.indexOf("outcome.kind === 'removeFailed'"),
    );
    expect(save).toContain('errorMessage(outcome.failure, locale)');
    const queries = read('../api/operations-queries.ts');
    const remove = queries.slice(
      queries.indexOf('export const useRemoveOperationsStandingCrew'),
      queries.indexOf('/** Editing the roster changes who is OFFERED'),
    );
    expect(remove).toContain('onError: formOwnsTheError,');
  });
});

// ── What stays the list's own ────────────────────────────────────────────────────────────────────

describe('Round 27 — what stays the standing crew’s own', () => {
  it('has no day, no notes, no type, no row colour', () => {
    expect(PAGE).not.toContain('<DayBox');
    expect(PAGE).not.toContain("'operations.crewPlan.columns.notes'");
    expect(PAGE).not.toContain('ShiftTypePicker');
    expect(PAGE).not.toContain('RowColourPicker');
    expect(PAGE).toContain("t('operations.standingCrew.dayless')");
  });

  it('reads the roster without the day’s facts, and asks the drop with nobody away', () => {
    expect(PAGE).toContain('(directory.data?.members ?? []).map(standingMember)');
    expect(PAGE).toContain('resolveDrop(rows, target, employeeId, roleOf(employeeId), null)');
  });

  it('the person’s card: «في الطاقم الثابت», and no attendance line', () => {
    const away = <PlanAttendanceFact away="absent" />;
    const board = text(
      render(
        <PlanMemberCardBody
          member={CAPTAIN}
          mayReadCrew
          seat="213 · قائد الطاقم"
          attendance={away}
        />,
      ),
    );
    expect(board).toContain(t('operations.crewPlan.card.seat'));
    expect(board).toContain(t('operations.crewPlan.away.day.absent'));
    const html = render(
      standing(
        <PlanMemberCardBody
          member={CAPTAIN}
          mayReadCrew
          seat="213 · قائد الطاقم"
          attendance={away}
        />,
      ),
    );
    expect(text(html)).toContain('في الطاقم الثابت');
    expect(text(html)).toContain('213 · قائد الطاقم');
    expect(html).not.toContain('data-plan-member-away');
    const free = text(
      render(standing(<PlanMemberCardBody member={CAPTAIN} mayReadCrew seat={null} />)),
    );
    expect(free).toContain('ليس في الطاقم الثابت');
  });

  it('the van’s card: the crew, the direction and the time — not the day’s drivers', () => {
    const crew: OperationsDayBoardVehicleCrewDto = {
      crewAssignmentId: 'sc-213',
      vehicleId: 'v-213',
      vehicleCode: '213',
      drivers: [],
      captains: [{ employeeId: 'e-cap', code: '0100007', fullNameAr: 'احمد سيد بركة محمد' }],
      specialist1: [],
      specialist2: [],
      direction: 'مدينة نصر',
      plannedTime: '07:30',
    };
    expect(text(render(<VehicleCrewCardBody crew={crew} />))).toContain(
      t('operations.board.card.drivers'),
    );
    const html = text(render(standing(<VehicleCrewCardBody crew={crew} />)));
    expect(html).not.toContain(t('operations.board.card.drivers'));
    expect(html).toContain('احمد سيد بركة محمد');
    expect(html).toContain('مدينة نصر');
  });

  it('names the screen it is on — the board’s words on the board, the standing crew’s here', () => {
    expect(showsDayFacts('board')).toBe(true);
    expect(showsDayFacts('standing')).toBe(false);
    expect(scopedKey('board', 'operations.crewPlan.pools.dropBack')).toBe(
      'operations.crewPlan.pools.dropBack',
    );
    expect(scopedKey('standing', 'operations.crewPlan.pools.dropBack')).toBe(
      'operations.standingCrew.plan.pools.dropBack',
    );
    expect(scopedKey('standing', 'operations.crewPlan.picked')).toBe('operations.crewPlan.picked');
    expect(
      text(
        render(
          standing(<ReturnPickedButton pool="captains" name="احمد" onReturn={() => undefined} />),
        ),
      ),
    ).toBe('إخراج احمد من الطاقم الثابت');
    expect(
      text(render(<ReturnPickedButton pool="captains" name="احمد" onReturn={() => undefined} />)),
    ).toBe(t('operations.crewPlan.pools.returnPicked', { name: 'احمد' }));
  });
});

// ── The slot, as drawn ───────────────────────────────────────────────────────────────────────────

describe('Round 27 — `CrewPlanSlot`, the board’s slot', () => {
  const ROW: PlanRow = {
    key: 'van:v-213',
    vehicleId: 'v-213',
    vehicleCode: '213',
    onRoster: false,
    crewId: 'sc-213',
    drivers: [],
    slots: { captain: [], specialist1: [], specialist2: [] },
    direction: null,
    plannedTime: null,
    shiftTypeId: null,
    rowColour: null,
    notes: null,
  };
  const decide = (target: DropTarget, employeeId: string): DropDecision =>
    resolveDrop([ROW], target, employeeId, employeeId === 'e-cap' ? 'captain' : 'specialist', null);
  const slot = (over: Partial<Parameters<typeof CrewPlanSlot>[0]> = {}): string =>
    render(
      standing(
        <CrewPlanSlot
          rowKey={ROW.key}
          rowName="213"
          slot="captain"
          seats={[]}
          canPlan
          selected={null}
          dragging={null}
          overDecision={null}
          decide={decide}
          listOpen={false}
          tinted
          onSelect={() => undefined}
          onRemove={() => undefined}
          onOpenList={() => undefined}
          onPlace={() => undefined}
          onDragStart={() => undefined}
          onDragEnd={() => undefined}
          {...over}
        />,
      ),
    );

  it('is a drop zone the frame finds by its mark; empty, it is its own «+ اختيار قائد»', () => {
    const html = slot();
    expect(html).toContain('data-slot-zone="van:v-213|captain"');
    expect(html).toContain('data-slot-pick="van:v-213|captain"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(text(html)).toContain(t('operations.crewPlan.picker.choose.captain'));
    // AA: the pick's words in slate-600 on the page's colour, never the bare slate-400.
    expect(html).toContain('text-slate-600');
  });

  it('seats the board’s chips — the card on a hover, the ✕ and the «+» of a slot with room', () => {
    const html = slot({
      seats: [{ member: CAPTAIN, wrong: null, refused: false, seatedAt: '213 · قائد الطاقم' }],
    });
    expect(html).toContain('data-crew-chip="e-cap"');
    expect(html).toContain('data-plan-member-hover="true"');
    expect(html).toContain('data-cell-control="remove"');
    expect(html).toContain('data-slot-add="true"');
    expect(html).not.toContain('data-slot-pick');
  });

  it('marks a seat held outside the role (Round 23), worded', () => {
    const html = slot({
      slot: 'specialist1',
      seats: [{ member: CAPTAIN, wrong: 'notSpecialist', refused: false, seatedAt: null }],
    });
    expect(html).toContain('data-wrong-slot="notSpecialist"');
    expect(text(html)).toContain(t('operations.crewPlan.wrongSlot.badge.notSpecialist'));
  });

  it('a chip picked up lights the slots it may go to with «ضع هنا»; a slot not its role’s stays dark', () => {
    const fits = slot({ selected: 'e-cap' });
    expect(fits).toContain('data-place="van:v-213|captain"');
    expect(text(fits)).toContain(t('operations.crewPlan.placeHere'));
    const dark = slot({ slot: 'specialist1', selected: 'e-cap' });
    expect(dark).not.toContain('data-place=');
  });

  it('under a drag: «ضع هنا» over the slot it lands in, red with why on one that refuses', () => {
    const landing = slot({
      dragging: 'e-cap',
      overDecision: { kind: 'place', key: ROW.key, slot: 'captain' },
    });
    expect(landing).toContain('data-drop-over="accept"');
    expect(landing).toContain('data-drop-landing="true"');
    const refused = slot({
      slot: 'specialist1',
      dragging: 'e-cap',
      overDecision: {
        kind: 'refuse',
        key: ROW.key,
        slots: ['specialist1'],
        reason: 'notSpecialist',
      },
    });
    expect(refused).toContain('data-drop-over="refuse"');
    expect(text(refused)).toContain(t('operations.crewPlan.wrongSlot.over.notSpecialist'));
  });

  it('the toolbar’s start and the «المعروض» pair are the board’s', () => {
    const hand = text(
      render(<CrewPlanHand pickedName="احمد" onCancel={() => undefined} hint="x" />),
    );
    expect(hand).toContain(t('operations.crewPlan.picked', { name: 'احمد' }));
    const legend = render(
      <CrewPlanHand pickedName={null} onCancel={() => undefined} hint="تلميح" />,
    );
    expect(legend).toContain('data-role-legend="true"');
    expect(text(legend)).toContain('تلميح');
    const shown = render(<FilteredCount shown={3} total={14} onClear={() => undefined} />);
    expect(shown).toContain('data-shown-count="3"');
    expect(shown).toContain('data-crew-plan-clear-filters="true"');
  });
});

// ── The words ────────────────────────────────────────────────────────────────────────────────────

describe('Round 27 — every new word in Arabic and English', () => {
  const KEYS = [
    ...[
      'hint',
      'viewOnly',
      'toBoard',
      'toBoardHint',
      'addVehicle',
      'dayless',
      'daylessHint',
      'counts',
      'countsHint',
      'total',
      'newTag',
      'newHint',
      'noneShown',
      'savedCount',
      'fileStem',
      'removeVehicle',
      'removeFailed',
      'saveFailed',
      'empty',
      'emptyHint',
      'unfiltered',
      'columns.actions',
      'picker.title',
      'picker.filtered',
      'picker.unfiltered',
      'picker.none',
      'picker.search',
    ].map((key) => `operations.standingCrew.${key}`),
    ...STANDING_CREW_STATES.map((state) => `operations.standingCrew.state.${state}`),
    ...PLURAL_FORMS.map((form) => `operations.standingCrew.leaveBody.${form}`),
    ...STANDING_WORD_KEYS,
  ];

  it.each(KEYS)('%s', (key) => {
    const ar = translate('ar', key);
    const en = translate('en', key);
    expect(ar).not.toBe(key);
    expect(en).not.toBe(key);
    expect(ar).not.toBe(en);
    expect(ar).toMatch(/[؀-ۿ]/u);
  });

  it('the page asks for no key it does not have', () => {
    const asked = [...PAGE.matchAll(/t\('(operations\.standingCrew\.[\w.]+)'/gu)].map(
      (match) => match[1] as string,
    );
    expect(asked.length).toBeGreaterThan(10);
    for (const key of asked) {
      expect(translate('ar', key), key).not.toBe(key);
      expect(translate('en', key), key).not.toBe(key);
    }
  });

  it('says the standing crew’s own words, formal', () => {
    expect(t('operations.standingCrew.addVehicle')).toBe('إضافة سيارة');
    expect(
      t('operations.standingCrew.undo.moveCrew', { name: 'احمد', where: '213 · قائد الطاقم' }),
    ).toBe('نقل احمد مع طاقمه إلى 213 · قائد الطاقم');
    expect(t('operations.standingCrew.plan.card.seat')).toBe('في الطاقم الثابت');
  });
});

// ── Round 27 review — the critic's findings, on the page ──────────────────────────────────────────
// The rules are tested on their own in lib/standing-crew.spec.ts; here, that the page goes through
// them, says what they found, and draws what the board draws.
describe('Round 27 review — the page', () => {
  const save = PAGE.slice(PAGE.indexOf('const save = async'), PAGE.indexOf('const exportExcel'));

  it('F1: rebases through `rebaseStandingDraft` — never the board’s bare rebase — and says what it dropped', () => {
    expect(PAGE).toContain('rebaseStandingDraft(state.rows, base, serverRows)');
    expect(PAGE).not.toMatch(/\brebaseDraft\(/u);
    expect(PAGE).toContain('standingEditsLost(history.now.rows, base, serverRows)');
    // Said once, after the render (never a toast from the render itself).
    const said = PAGE.slice(PAGE.indexOf('useEffect(() => {\n    if (lostOnServer.length === 0)'));
    expect(said).toContain("t('operations.standingCrew.goneOnServer.title'");
    expect(said.indexOf('setLostOnServer([])')).toBeGreaterThan(0);
  });

  it('F2: a save that stopped says which vehicles it had already taken out', () => {
    expect(save).toContain('removedBeforeStop({ removeVehicleIds }, outcome)');
    expect(save).toContain("t('operations.standingCrew.partlySaved'");
    // Beside the refused DELETE, beside a person the PUT's refusal names, beside any other refusal.
    expect(save.match(/withPartly\(/gu)?.length).toBe(3);
  });

  it('F3: the PUT, like the DELETE, keeps the global notifier quiet — one toast a refusal', () => {
    const queries = read('../api/operations-queries.ts');
    const putHook = queries.slice(
      queries.indexOf('export const useSetOperationsStandingCrew'),
      queries.indexOf('export const useRemoveOperationsStandingCrew'),
    );
    expect(putHook).toContain('onError: formOwnsTheError,');
  });

  it('F4: the clash sentence only for the clash; anything else in the failure’s own words', () => {
    expect(save.replace(/\s+/gu, ' ')).toContain(
      "isCrewClash(failure) ? t('operations.standingCrew.saveFailed') : errorMessage(failure, locale), withPartly(null),",
    );
  });

  it('F5: the slot and the direction box fill their column, the board’s width their floor', () => {
    const SLOT = read('../components/CrewPlanSlot.tsx');
    expect(SLOT).toContain('w-[8.75rem] min-w-full');
    expect(PAGE).toContain('w-[7.5rem] min-w-full');
  });

  it('F6: a reader without the plan permission gets no «إزالة» column at all', () => {
    const actions = PAGE.slice(
      PAGE.indexOf("key: 'actions'") - 200,
      PAGE.indexOf("key: 'actions'"),
    );
    expect(actions).toContain('...(canPlan');
  });

  it('F7: a captain’s crew moved with him is SAID, by name — whatever moved him', () => {
    const place = PAGE.slice(PAGE.indexOf('const place = ('), PAGE.indexOf('const free = ('));
    expect(place).toContain('if (step.companions.length > 0) {');
    expect(place).toContain("t('operations.standingCrew.movedWithCrew.title')");
    expect(place).toContain("t('operations.standingCrew.movedWithCrew.body', {");
    expect(place).toContain('names: listed(step.companions.map(');
  });

  it('F8: a WRONG_SLOT refusal rings the person on the row the server names, as on the board', () => {
    expect(save).toContain('const sent = standingPutRows(rows, serverRows);');
    expect(save).toContain('planRefusal(failure, sent)');
    expect(save).toContain('setRefusal({ ...named, message });');
    expect(PAGE).toContain(
      'refused: refusal?.key === row.key && refusal.person?.employeeId === employeeId',
    );
    expect(PAGE).not.toContain('refused: false');
    expect(PAGE).toContain("'data-row-refused': refusal.field");
    // Moving him, taking him off, taking the row out or back, or saving again settles it.
    expect(PAGE.match(/settleRefusedPerson\(employeeId\)/gu)?.length).toBe(2);
    expect(PAGE).toContain('setRefusal((current) => (current?.key === row.key ? null : current));');
    expect(PAGE).toContain('touched.includes(current.key) ? null : current');
  });

  it('F8: the ring is drawn on the chip the slot is told about', () => {
    const html = render(
      standing(
        <CrewPlanSlot
          rowKey="van:v-213"
          rowName="213"
          slot="captain"
          seats={[{ member: CAPTAIN, wrong: null, refused: true, seatedAt: null }]}
          canPlan
          selected={null}
          dragging={null}
          overDecision={null}
          decide={() => null}
          listOpen={false}
          onSelect={() => undefined}
          onRemove={() => undefined}
          onOpenList={() => undefined}
          onPlace={() => undefined}
          onDragStart={() => undefined}
          onDragEnd={() => undefined}
        />,
      ),
    );
    expect(html).toContain('data-refused');
  });

  it('every new word in Arabic and English, formal', () => {
    for (const key of [
      'operations.standingCrew.movedWithCrew.title',
      'operations.standingCrew.movedWithCrew.body',
      'operations.standingCrew.goneOnServer.title',
      'operations.standingCrew.goneOnServer.body',
      'operations.standingCrew.partlySaved',
    ]) {
      const ar = translate('ar', key);
      const en = translate('en', key);
      expect(ar, key).not.toBe(key);
      expect(en, key).not.toBe(key);
      expect(ar).toMatch(/[؀-ۿ]/u);
    }
    expect(
      t('operations.standingCrew.movedWithCrew.body', {
        name: 'احمد',
        where: '250 · قائد الطاقم',
        names: 'عمرو، اسلام',
      }),
    ).toBe('انتقل احمد إلى 250 · قائد الطاقم ومعه: عمرو، اسلام.');
    // A toast's title is ONE line (`truncate`): the codes lead, the why is in its body.
    expect(t('operations.standingCrew.goneOnServer.title', { codes: '249' })).toBe(
      'أُخرجت 249 من الطاقم الثابت',
    );
    expect(t('operations.standingCrew.partlySaved', { codes: '276' })).toBe(
      'وقد حُفظ قبل ذلك إخراج 276 من الطاقم الثابت، ولم تُحفظ بقية التغييرات.',
    );
  });
});
