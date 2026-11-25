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
//   • every new word in Arabic and English;
//   • Round 34 G — the head is the board's: no legend and no hint, the counters in the toolbar where
//     they were, somebody picked at their start, the bar one line from 1280, «المعروض N من M» where
//     the board puts it, «للعرض فقط» for a reader without the grant.
//
// The suite runs in node with no DOM: the pieces are rendered on their own, the page itself is
// server-rendered on a seeded cache (Round 34 G), and is read as source (as the board's own specs
// read it).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type Locale,
  type MeDto,
  type OperationsCrewMemberDto,
  type OperationsDayBoardVehicleCrewDto,
  type OperationsStandingCrewBoardDto,
  type OperationsStandingCrewRowDto,
} from '@ecms/contracts';
import type { ReactNode } from 'react';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { PLURAL_FORMS } from '../../../shared/lib/plural';
import { listKey } from '../../../shared/lib/query-keys';
import { translate } from '../../../platform/localization/i18n';
import { VehicleCrewCardBody } from '../components/BoardCrewCards';
import { PlanAttendanceFact, PlanMemberCardBody } from '../components/CrewPlanMemberCard';
import {
  CREW_PLAN_BAR_LINE,
  CrewPlanHand,
  FilteredCount,
  HEAD_CHIP,
  HEAD_STRIP,
  ReturnPickedButton,
} from '../components/CrewPlanFrame';
import { CrewPlanSlot } from '../components/CrewPlanSlot';
import { PLAN_ICON } from '../components/crew-plan-icons';
import {
  CrewPlanScopeProvider,
  STANDING_WORD_KEYS,
  scopedKey,
  showsDayFacts,
} from '../components/crew-plan-scope';
import { resolveDrop, type DropDecision, type DropTarget } from '../lib/crew-drag';
import { type PlanRow } from '../lib/crew-plan';
import { STANDING_CREW_STATES, standingCounts, toStandingPlanRows } from '../lib/standing-crew';
import { StandingCrewPage } from './StandingCrewPage';

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
      // Round 34 G — the board's one-line bar, the frame's since (was `CREW_PLAN_BAR` itself).
      'className={CREW_PLAN_BAR_LINE} data-crew-plan-bar="true"',
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
    // The board itself draws the same frame pieces — one source, so the two cannot drift. Its bar is
    // the same bar kept on ONE line from 1280 (Round 34 E: the totals left it for the toolbar).
    for (const piece of [
      'className={CREW_PLAN_BAR_LINE} data-crew-plan-bar="true"',
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
    // Round 34 G — one bar line for both, in the frame (it was the board's own).
    expect(read('../components/CrewPlanFrame.tsx')).toMatch(
      /export const CREW_PLAN_BAR_LINE = cn\(\s*CREW_PLAN_BAR,\s*'min-\[1280px\]:flex-nowrap min-\[1280px\]:gap-x-2',?\s*\)/u,
    );
    expect(BOARD).not.toContain('const CREW_PLAN_BAR_LINE =');
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

  // Round 34 G — REWRITTEN (title kept): the hand holds the counters (its children), no legend and
  // no hint (`hint` is gone from `CrewPlanHand`).
  it('the toolbar’s start and the «المعروض» pair are the board’s', () => {
    const hand = text(
      render(
        <CrewPlanHand pickedName="احمد" onCancel={() => undefined}>
          <span>١٤</span>
        </CrewPlanHand>,
      ),
    );
    expect(hand).toContain(t('operations.crewPlan.picked', { name: 'احمد' }));
    const idle = render(
      <CrewPlanHand pickedName={null} onCancel={() => undefined}>
        <span data-standing-counts="true" />
      </CrewPlanHand>,
    );
    expect(idle).not.toContain('data-role-legend');
    expect(idle).toContain('data-crew-plan-head-idle="true"><span data-standing-counts="true">');
    const shown = render(<FilteredCount shown={3} total={14} onClear={() => undefined} />);
    expect(shown).toContain('data-shown-count="3"');
    expect(shown).toContain('data-crew-plan-clear-filters="true"');
  });
});

// ── The words ────────────────────────────────────────────────────────────────────────────────────

describe('Round 27 — every new word in Arabic and English', () => {
  const KEYS = [
    ...[
      // Round 34 G — 'hint' left with the legend's line: «واسمح الحاجات اللى فوق دى».
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

// ── Round 34 G — the head is the board's ─────────────────────────────────────────────────────────
// The owner, of the board's head: «واسمح الحاجات اللى فوق دى وحط مكاناها الاجماليات بدل ما انت لما بختار
// حاجه بينزل سطر ل تحت»; asked whether «الطاقم الثابت» should match: «اعمل الافضل واعمل ميرج». The page
// itself, server-rendered on a seeded cache (a planner, and a reader without the grant).

const T0 = '2026-01-01T00:00:00.000Z';
const srow = (
  code: string,
  slots: Partial<OperationsStandingCrewRowDto> = {},
): OperationsStandingCrewRowDto => ({
  id: `sc-${code}`,
  vehicleId: `v-${code}`,
  vehicleCode: code,
  uncoded: null,
  captainEmployeeIds: [],
  specialist1EmployeeIds: [],
  specialist2EmployeeIds: [],
  direction: null,
  plannedTime: null,
  version: 1,
  createdAt: T0,
  updatedAt: T0,
  ...slots,
});
const STANDING_DTO: OperationsStandingCrewBoardDto = {
  rows: [
    srow('213', {
      captainEmployeeIds: ['e-cap'],
      specialist1EmployeeIds: ['e-s1'],
      specialist2EmployeeIds: ['e-s2'],
    }),
    srow('248', { captainEmployeeIds: ['e-c2'], specialist1EmployeeIds: ['e-s3'] }),
    srow('250', { specialist1EmployeeIds: ['e-s4'] }),
    srow('276'),
  ],
  available: [],
  unidentifiedVehicles: 0,
  availableIsFiltered: true,
};
const COUNTS = standingCounts(toStandingPlanRows(STANDING_DTO.rows));
const renderPage = ({
  plan = true,
  locale = 'ar',
}: { plan?: boolean; locale?: Locale } = {}): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(listKey('operations', 'standingCrew', {}), STANDING_DTO);
  qc.setQueryData(listKey('operations', 'crewDirectory', { date: 'tomorrow' }), {
    date: T0,
    members: [CAPTAIN],
    rosterIsDerived: true,
  });
  qc.setQueryData(listKey('operations', 'areas', { whole: true, isActive: true }), ['مدينة نصر']);
  const permissions = plan
    ? { 'operationsCrew.view': 'organization', 'operationsCrew.plan': 'organization' }
    : { 'operationsCrew.view': 'organization' };
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: { me: { id: 'u1', permissions } as unknown as MeDto, status: 'signedIn' as const },
      ui: { theme: 'dark' as const, sidebarOpen: false },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/operations/standing-crew']}>
          <Routes>
            <Route path="/operations/standing-crew" element={<StandingCrewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};
const between = (html: string, from: string, to: string): string => {
  const start = html.indexOf(from);
  expect(start, from).toBeGreaterThan(-1);
  const end = html.indexOf(to, start);
  expect(end, to).toBeGreaterThan(start);
  return html.slice(start, end);
};
/** The toolbar's markup, from its mark to the bar's. */
const toolbarOf = (html: string): string =>
  between(html, 'data-crew-plan-toolbar="true"', 'data-crew-plan-bar="true"');
/** An element's opening tag, by an attribute it carries — its entities read back. */
const tagWith = (html: string, mark: string): string => {
  const at = html.indexOf(mark);
  expect(at, mark).toBeGreaterThan(-1);
  return html
    .slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1)
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&#x27;/gu, "'");
};
/** An element's classes, as a set — the order `cn` writes them in is not the point. */
const classesIn = (tag: string): string[] => (/class="([^"]*)"/u.exec(tag)?.[1] ?? '').split(' ');

describe('Round 34 G — the legend and the hint are gone from «الطاقم الثابت»', () => {
  it('the page draws no legend and no hint, in Arabic or English — and the key went with it', () => {
    const hint = {
      ar: 'اضغط «+ اختيار» في الخانة، أو اسحب الاسم إلى صف السيارة أو إلى الخانة',
      en: 'Press «+ Choose» in a slot, or drag a name onto a vehicle’s row or a slot',
    };
    for (const locale of ['ar', 'en'] as const) {
      const html = renderPage({ locale });
      expect(html, locale).not.toContain('data-role-legend');
      expect(text(html)).not.toContain(hint[locale]);
      for (const role of ['captain', 'dual', 'specialist']) {
        expect(text(toolbarOf(html))).not.toContain(
          t(`operations.crewPlan.role.${role}`, undefined, locale),
        );
      }
      expect(translate(locale, 'operations.standingCrew.hint')).toBe(
        'operations.standingCrew.hint',
      );
    }
    expect(PAGE).not.toContain("'operations.standingCrew.hint'");
  });
});

describe('Round 34 G — the counters stand in the toolbar, where the legend was', () => {
  it('the toolbar’s start holds the four counters, before the acts; the bar holds none', () => {
    const html = renderPage();
    const toolbar = toolbarOf(html);
    const idle = between(toolbar, 'data-crew-plan-head-idle="true"', '</button></div>');
    expect(idle).toContain('data-standing-counts="true"');
    expect(toolbar.indexOf('data-standing-counts')).toBeLessThan(
      toolbar.indexOf('data-standing-to-board'),
    );
    const bar = between(html, 'data-crew-plan-bar="true"', 'data-crew-plan-grid="true"');
    expect(bar).not.toContain('data-standing-counts');
    expect(bar).not.toContain('data-standing-count=');
    // The bar: the dayless mark and the three filters, ONE line from 1280 (the board's bar line).
    expect(classesIn(tagWith(html, 'data-crew-plan-bar="true"'))).toEqual(
      expect.arrayContaining(['min-[1280px]:flex-nowrap', 'min-[1280px]:gap-x-2']),
    );
    expect(CREW_PLAN_BAR_LINE).toContain('min-[1280px]:flex-nowrap min-[1280px]:gap-x-2');
    expect(bar).toContain('data-standing-dayless="true"');
    expect(bar).toContain('data-filter-person="true"');
  });

  it('the board’s compact strip and chips — titles, hooks, figures and presses kept', () => {
    const html = renderPage();
    const group = tagWith(html, 'data-standing-counts="true"');
    expect(group).toContain('role="group"');
    expect(group).toContain(`aria-label="${t('operations.standingCrew.counts')}"`);
    expect(group).toContain(`title="${t('operations.standingCrew.countsHint')}"`);
    expect(classesIn(group).sort()).toEqual(HEAD_STRIP.split(' ').sort());
    for (const [state, label, count] of [
      ['all', t('operations.standingCrew.total'), COUNTS.total],
      ...STANDING_CREW_STATES.map(
        (state) => [state, t(`operations.standingCrew.state.${state}`), COUNTS[state]] as const,
      ),
    ] as const) {
      const chip = tagWith(html, `data-standing-count="${state}"`);
      // The toolbar's compact chip (26px high, 10.5px), not the bar's `COUNT_CHIP` any more.
      expect(classesIn(chip), state).toEqual(expect.arrayContaining(HEAD_CHIP.split(' ')));
      // Nothing filters on a fresh page: «السيارات» is the one pressed.
      expect(chip).toContain(`aria-pressed="${state === 'all' ? 'true' : 'false'}"`);
      const button = between(html, `data-standing-count="${state}"`, '</button>');
      expect(text(`<x ${button}`)).toContain(label);
      expect(button).toContain(`>${new Intl.NumberFormat('ar-EG').format(count)}</span>`);
    }
    expect(COUNTS).toEqual({ total: 4, complete: 1, short: 2, empty: 1 });
    // Pressed again it lets go; «السيارات» shows all — the page's own handler, as before.
    expect(PAGE).toContain('onClick={() => setStateFilter(on || state === null ? null : state)}');
    // The fade and the wheel of the board's strip.
    expect(PAGE).toContain('const stripEdges = useSideScroll(stripRef);');
    expect(PAGE).toContain("const stripFade = sideFade(stripEdges, locale === 'ar');");
    expect(PAGE).toContain('style={{ maskImage: stripFade, WebkitMaskImage: stripFade }}');
  });

  // Round 34 H critic — REWRITTEN (title kept): the acts' box is the board's, and the board adds
  // `NARROW_ACTS_ROOM` below 360 (its six acts and a past day's record take one line or two there);
  // this page's acts keep one line at every width, in every state — measured — so it needs no room
  // of its own.
  it('the toolbar is the board’s: the same line, the same hand, the same acts’ box', () => {
    for (const piece of [
      'className="flex flex-wrap items-center gap-2 min-[1280px]:flex-nowrap"\n          data-crew-plan-toolbar="true"',
      'className="basis-full min-[1280px]:basis-0 min-[1280px]:flex-1"',
      'ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1 min-[1280px]:flex-nowrap',
    ]) {
      expect(PAGE, piece).toContain(piece);
      expect(BOARD, piece).toContain(piece);
    }
    expect(PAGE).toContain(
      '<span className="ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1 min-[1280px]:flex-nowrap">',
    );
    expect(BOARD).toContain(
      "'ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1 min-[1280px]:flex-nowrap',\n              NARROW_ACTS_ROOM,",
    );
    expect(PAGE).not.toContain('NARROW_ACTS_ROOM');
  });
});

describe('Round 34 G — the acts keep their words wherever they fit one line', () => {
  const classesOf = (constant: string): string => {
    const at = PAGE.indexOf(`const ${constant} =`);
    return PAGE.slice(at, PAGE.indexOf(';\n', at));
  };
  // Round 34 G critic — REWRITTEN: «in words from 640 (beside the counters from 1280); below, 44px
  // icons — each word its name and its tooltip». Below 640 the buttons take their smaller size, and
  // there the words are 391px in Arabic and 414 in English: one line from 440 / 480. They had turned
  // to icons all the way up to 639 — «إضافة سيارة» a bare «+» there.
  it('in words down to 480 (beside the counters from 1280); below, 44px icons — each word its name and its tooltip', () => {
    // Measured on the built page: 391px of words in Arabic, 414 in English below 640 («حفظ (n)» 15
    // to 22 more) — one line from 480 in both; 459 / 484 from 640. Never the board's 1280–1759 band.
    expect(classesOf('ACT_WORD')).toContain("'max-[479px]:sr-only'");
    expect(classesOf('ICON_ACT')).toContain(
      "'max-[479px]:w-11 max-[479px]:justify-center max-[479px]:!px-0'",
    );
    expect(classesOf('WORD_ACT')).toContain("'max-[639px]:h-11'");
    expect(PAGE).not.toMatch(/max-\[639px\]:(sr-only|w-11)/u);
    expect(PAGE).not.toMatch(/min-\[1280px\]:max-\[1759px\]:sr-only/u);
    const html = renderPage();
    const toolbar = toolbarOf(html);
    for (const [mark, word, title] of [
      [
        'data-standing-to-board="true"',
        t('operations.standingCrew.toBoard'),
        `${t('operations.standingCrew.toBoard')} — ${t('operations.standingCrew.toBoardHint')}`,
      ],
      [
        'data-standing-add="true"',
        t('operations.standingCrew.addVehicle'),
        t('operations.standingCrew.addVehicle'),
      ],
      ['data-crew-plan-excel="true"', 'Excel', 'Excel'],
      [
        'data-crew-plan-discard="true"',
        t('operations.crewPlan.discard'),
        t('operations.crewPlan.undo.none'),
      ],
    ] as const) {
      const tag = tagWith(toolbar, mark);
      expect(tag, mark).toContain(`title="${title}"`);
      // A finger's height below 640, in words or not; a 44px square below 480.
      expect(classesIn(tag)).toEqual(
        expect.arrayContaining(['max-[639px]:h-11', 'max-[479px]:w-11', 'max-[479px]:!px-0']),
      );
      const act = toolbar.slice(toolbar.indexOf(mark));
      expect(act.slice(0, act.search(/<\/(button|a)>/u))).toContain(
        `<span class="max-[479px]:sr-only">${word}</span>`,
      );
    }
    // «حفظ» keeps its word at every width — as high as the icons below 640.
    const save = tagWith(toolbar, 'data-crew-plan-save=');
    expect(classesIn(save)).toContain('max-[639px]:h-11');
    expect(classesIn(save)).not.toContain('max-[479px]:w-11');
  });

  it('«إضافة سيارة» below 480 is a van and a plus — never a bare «+»; mirrored in Arabic', () => {
    const html = renderPage();
    const add = html.slice(html.indexOf('data-standing-add="true"'));
    const button = add.slice(0, add.indexOf('</button>'));
    for (const d of PLAN_ICON.addVan) expect(button, d).toContain(`d="${d}"`);
    expect(button).not.toContain('d="M12 4v16m8-8H4"');
    expect(button).toContain('rtl:-scale-x-100');
  });

  it('a reader without the grant keeps «لوحة التشغيلة» and «Excel» in words at every width — 262px, one line at 320', () => {
    for (const locale of ['ar', 'en'] as const) {
      const toolbar = toolbarOf(renderPage({ plan: false, locale }));
      for (const [mark, word] of [
        ['data-standing-to-board="true"', translate(locale, 'operations.standingCrew.toBoard')],
        ['data-crew-plan-excel="true"', 'Excel'],
      ] as const) {
        const tag = tagWith(toolbar, mark);
        expect(classesIn(tag), `${locale} ${mark}`).toContain('max-[639px]:h-11');
        expect(classesIn(tag)).not.toContain('max-[479px]:w-11');
        const act = toolbar.slice(toolbar.indexOf(mark));
        expect(act.slice(0, act.search(/<\/(button|a)>/u))).toContain(`<span>${word}</span>`);
      }
      expect(toolbar).not.toContain('max-[479px]:sr-only');
    }
  });
});

describe('Round 34 G — somebody picked stands at the counters’ start; nothing takes a line', () => {
  it('the pill, «إلغاء» and the spoken region — the counters after it, still seen and pressed', () => {
    const html = render(
      <CrewPlanHand pickedName={CAPTAIN.fullNameAr} onCancel={() => undefined}>
        <div role="group" data-standing-counts="true" className={HEAD_STRIP}>
          <button type="button" data-standing-count="all" className={HEAD_CHIP}>
            السيارات ٤
          </button>
        </div>
      </CrewPlanHand>,
    );
    expect(html).toMatch(/^<div class="flex min-w-0 items-center" data-crew-plan-head="true">/u);
    expect(html).toContain('aria-live="polite" data-crew-plan-head-hand="true"');
    expect(text(html)).toContain(t('operations.crewPlan.picked', { name: CAPTAIN.fullNameAr }));
    expect(html).toContain('data-crew-picked-cancel="true"');
    expect(html.indexOf('data-crew-picked="true"')).toBeLessThan(
      html.indexOf('data-standing-counts'),
    );
    expect(html).not.toMatch(/\binvisible\b|aria-hidden="true"[^>]*data-standing-count/u);
    // The page wires it: «إلغاء» and Escape put the chip down; the spoken region is there on load.
    const toolbar = PAGE.slice(PAGE.indexOf('data-crew-plan-toolbar="true"'));
    expect(toolbar).toContain('pickedName={pickedName}');
    expect(toolbar).toContain('onCancel={() => setSelected(null)}');
    expect(PAGE).toContain("if (event.key === 'Escape') setSelected(null);");
    expect(renderPage()).toContain(
      '<div aria-live="polite" data-crew-plan-head-hand="true" class="flex min-w-0 items-center"></div>',
    );
  });

  it('«المعروض N من M» where the board puts it: the bar’s end from 1280, the counters’ line below', () => {
    expect(PAGE).toContain('const countAt = filteredCountAt({ oneLineHead: useMinWidth(1280) });');
    const hand = PAGE.slice(PAGE.indexOf('<CrewPlanHand'), PAGE.indexOf('</CrewPlanHand>'));
    const strip = hand.indexOf('data-standing-counts="true"');
    const count = hand.indexOf("{filtering && countAt === 'head' && (");
    expect(strip).toBeGreaterThan(0);
    expect(count).toBeGreaterThan(strip);
    expect(hand.slice(count)).toMatch(
      /<FilteredCount\s+shown=\{shown\.length\}\s+total=\{rows\.length\}\s+onClear=\{clearFilters\}\s+compact=\{phone\}\s+\/>/u,
    );
    const bar = PAGE.slice(
      PAGE.indexOf('data-crew-plan-bar="true"'),
      PAGE.indexOf('<CrewRosterNotice'),
    );
    expect(bar).toContain("{filtering && countAt === 'bar' && (");
    expect(bar).toContain('<span className="flex shrink-0 min-[1280px]:ms-auto">');
    expect(PAGE.match(/<FilteredCount\b/gu)?.length).toBe(2);
    const acts = PAGE.slice(
      PAGE.indexOf('</CrewPlanHand>'),
      PAGE.indexOf('data-crew-plan-bar="true"'),
    );
    expect(acts).not.toContain('<FilteredCount');
    // Nothing filters on load: no count is drawn.
    expect(renderPage()).not.toContain('data-crew-plan-filtered');
  });
});

describe('Round 34 G — a reader without the grant: «للعرض فقط», not a line', () => {
  it('a lock and «للعرض فقط» first among the acts — why in full, in the standing crew’s words', () => {
    for (const locale of ['ar', 'en'] as const) {
      const html = renderPage({ plan: false, locale });
      const toolbar = toolbarOf(html);
      const acts = toolbar.slice(toolbar.indexOf('data-crew-view-only'));
      const why = translate(locale, 'operations.standingCrew.viewOnly');
      expect(tagWith(toolbar, 'data-crew-view-only="true"'), locale).toContain(`title="${why}"`);
      expect(acts).toContain(`<span class="sr-only">${why}</span>`);
      expect(acts).toContain(
        `<span aria-hidden="true">${translate(locale, 'operations.crewPlan.viewOnlyMark')}</span>`,
      );
      expect(toolbar.indexOf('data-crew-view-only')).toBeLessThan(
        toolbar.indexOf('data-standing-to-board'),
      );
      // Read only: no «إضافة سيارة», «تراجع» or «حفظ»; the counters still filter.
      expect(toolbar).not.toContain('data-standing-add');
      expect(toolbar).not.toContain('data-crew-plan-save');
      expect(toolbar).toContain('data-standing-count="short"');
    }
    // A planner gets no mark.
    expect(renderPage()).not.toContain('data-crew-view-only');
  });
});
