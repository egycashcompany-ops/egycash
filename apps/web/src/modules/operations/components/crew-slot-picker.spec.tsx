// «لوحة التشغيلة», Round 22 — the slot's list (E), and somebody away that day (F), as drawn.
//
// The owner, on the live board:
//   E. «وعاوز مكان عند العربيه زى الحركة كدا لما ادوس عليه يجيب قايمة الناس اللى اختار منهم» — pressing a
//      slot opens the people to pick from, as Fleet's «الحركة» seat opens its drivers, so seating
//      somebody never hangs on a drag;
//   F. «وعاوز لو القائد غايب يظهر تحت الكل بقى فى الاخر يبقى باللون الباهت ومقدرش احطه على العربيه و
//      كذلك الاخصائيين» — away people last, pale, not movable, refused by every slot; somebody seated
//      before HR recorded it is marked and stays.
// And Round 23 — «فى مشكلتين الاولى ان قولتلك لو قائد واخصائى يبقى فى القايمة بتاعت القائد بس يكونوا
// فى الاخر … والتانية ممنوع ان اعين قائد مكان اخصائى والعكس الا فى حالة انه قائد اخصائى»: each slot
// lists only who fits it, the captain-specialists at the end of each part; a held seat is marked.
//
// What a typecheck cannot see:
//   • the list is the drop's own rule (`resolveDrop`): who it offers, who it closes, and that picking
//     somebody seated elsewhere MOVES him;
//   • its parts: the slot's pool first, «متاح N» on each tab, a combobox over a listbox whose
//     arrows skip the closed options, three named parts, the away ones last, closed, with why;
//   • the page: a «+ اختيار» in every empty slot, a «+» beside a half-full slot's ✕, a pick that runs
//     the drop's decision and step, one list for the board, Fleet's bottom sheet on a phone;
//   • the chip: pale, closed and unmovable in a pool; marked and still movable on a row; the card's
//     attendance line; and the server's refusal in words.
//
// The suite runs in node with no DOM: the list's parts are rendered on their own (`useSlotPickerParts`
// — the panel and the sheet only place them), the page is read as source.
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
  type OperationsCrewAvailability,
  type OperationsCrewMemberDto,
  type OperationsCrewRequirementsDto,
} from '@ecms/contracts';
import type { ReactNode } from 'react';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { translate } from '../../../platform/localization/i18n';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { crewRoleOf, vehiclelessRow, type PlanRow } from '../lib/crew-plan';
import { nextPickable, slotPickList, slotPool, slotRoles } from '../lib/crew-picker';
import { CrewPlanChip } from './CrewPlanChip';
import { PlanAttendanceFact, PlanMemberCardBody } from './CrewPlanMemberCard';
import { useSlotPickerParts, type SlotPickerProps } from './CrewSlotPicker';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const requirements = (
  over: Partial<OperationsCrewRequirementsDto>,
): OperationsCrewRequirementsDto => ({
  id: 'r',
  employeeId: 'e',
  isCaptain: false,
  isSpecialist: false,
  hasWeapon: false,
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
  ...over,
});

const person = (
  id: string,
  name: string,
  over: Partial<OperationsCrewRequirementsDto>,
  availability: OperationsCrewAvailability | null = null,
): OperationsCrewMemberDto => ({
  employeeId: `e-${id}`,
  code: id,
  fullNameAr: name,
  status: 'active',
  jobTitle: null,
  phone: null,
  branchId: null,
  requirements: requirements(over),
  assignedVehicleId: null,
  availability,
});

const CAPTAIN = { isCaptain: true, hasWeapon: true };
const BLUE = { isCaptain: true, isSpecialist: true };
const RED = { isSpecialist: true };

/** The owner's board: one saved row without a van — and a van with a crew on it. */
const ROSTER = [
  person('0100007', 'احمد سيد بركة محمد', CAPTAIN),
  person('0100008', 'محمد ياسر احمد علي', CAPTAIN),
  person('0100016', 'هاني محمد صلاح الدين', CAPTAIN, 'absent'),
  person('0200011', 'احمد سيد محمود محمود', BLUE),
  person('0200052', 'مصطفى حمدي سليمان', BLUE, 'onLeave'),
  person('0300012', 'اسلام مسعد عويس', RED),
  person('0300021', 'عمرو سعيد محمد', RED, 'absent'),
  person('0300057', 'مصطفى سعيد عبده', RED),
];
const LOOSE: PlanRow = { ...vehiclelessRow(1), key: 'loose:c-owner', crewId: 'c-owner' };
const VAN: PlanRow = {
  ...vehiclelessRow(2),
  key: 'van:v-248',
  vehicleId: 'v-248',
  vehicleCode: '248',
  // 0100008 leads it; 0300021 was put on it before HR recorded his absence.
  slots: { captain: ['e-0100008'], specialist1: ['e-0300021'], specialist2: [] },
};
const ROWS = [VAN, LOOSE];
const ids = (list: { member: OperationsCrewMemberDto }[]): string[] =>
  list.map((one) => one.member.employeeId);
const crewRole = (member: OperationsCrewMemberDto) => crewRoleOf(member.requirements);

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
const t = (key: string, vars?: Record<string, string>, locale: Locale = 'ar'): string =>
  translate(locale, key, vars);
const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// ── E — the list, by the drop's own rule ───────────────────────────────────────────────────────────

describe('E — the list a slot opens is the drop’s own rule', () => {
  it('belongs to the slot’s own pool, and offers its role first, then the captain-specialists', () => {
    expect(slotPool('captain')).toBe('captains');
    expect(slotPool('specialist1')).toBe('specialists');
    expect(slotPool('specialist2')).toBe('specialists');
    expect(slotRoles('captain')).toEqual(['captain', 'dual']);
    expect(slotRoles('specialist1')).toEqual(['specialist', 'dual']);
    expect(slotRoles('specialist2')).toEqual(['specialist', 'dual']);
  });

  it('lists the free first, then who sits elsewhere (picking MOVES him), then the away ones, closed', () => {
    const list = slotPickList(ROSTER, ROWS, { key: LOOSE.key, slot: 'captain' }, '');
    expect(
      list.options.map((one) => `${one.member.code}:${one.section}:${String(one.pickable)}`),
    ).toEqual([
      '0100007:free:true',
      '0200011:free:true', // the BLUE after the green, as the pool lists them
      '0100008:seated:true', // on van 248 — picked, he leaves it
      '0100016:away:false',
      '0200052:away:false',
    ]);
    expect(list.options.find((one) => one.section === 'seated')?.seat).toEqual({
      key: VAN.key,
      slot: 'captain',
    });
    // «متاح N» — the pool's own figure: free and not away.
    expect(list.free).toBe(2);
  });

  it('offers nobody already in that very slot; somebody seated before his absence moves only on his row', () => {
    const own = slotPickList(ROSTER, ROWS, { key: VAN.key, slot: 'specialist2' }, '');
    // 0300021 sits on 248 already, away: slot to slot on his own row is allowed, as the server does.
    expect(own.options.find((one) => one.member.code === '0300021')).toMatchObject({
      section: 'away',
      pickable: true,
    });
    const elsewhere = slotPickList(ROSTER, ROWS, { key: LOOSE.key, slot: 'specialist1' }, '');
    expect(elsewhere.options.find((one) => one.member.code === '0300021')).toMatchObject({
      section: 'away',
      pickable: false,
    });
    const same = slotPickList(ROSTER, ROWS, { key: VAN.key, slot: 'specialist1' }, '');
    expect(ids(same.options)).not.toContain('e-0300021');
  });

  it('a full slot offers nothing to pick, and the search narrows by name or code, folded', () => {
    const full: PlanRow = {
      ...LOOSE,
      slots: { captain: ['e-0100007', 'e-0200011'], specialist1: [], specialist2: [] },
    };
    const none = slotPickList(ROSTER, [VAN, full], { key: full.key, slot: 'captain' }, '');
    expect(none.options.every((one) => !one.pickable)).toBe(true);
    expect(
      ids(slotPickList(ROSTER, ROWS, { key: LOOSE.key, slot: 'captain' }, 'أحمد').options),
      // «محمد ياسر احمد علي» too — on van 248, so after the free ones.
    ).toEqual(['e-0100007', 'e-0200011', 'e-0100008']);
    expect(
      ids(slotPickList(ROSTER, ROWS, { key: LOOSE.key, slot: 'specialist1' }, '0300057').options),
    ).toEqual(['e-0300057']);
  });

  // Round 23 — «ممنوع ان اعين قائد مكان اخصائى والعكس الا فى حالة انه قائد اخصائى».
  it('offers a specialist’s slot the specialists, then the captain-specialists — never a captain-only', () => {
    for (const slot of ['specialist1', 'specialist2'] as const) {
      const list = slotPickList(ROSTER, ROWS, { key: LOOSE.key, slot }, '');
      expect(
        list.options.map((one) => `${one.member.code}:${one.section}:${String(one.pickable)}`),
        slot,
      ).toEqual([
        '0300012:free:true',
        '0300057:free:true',
        '0200011:free:true', // the BLUE one — at the end of the free part
        // Away: the pools' own tails — those on no row first (blue last among them), then the one
        // on van 248 since before HR recorded his absence, who may not go to another row.
        '0200052:away:false',
        '0300021:away:false',
      ]);
      for (const option of list.options) {
        expect(
          option.member.requirements?.isCaptain === true &&
            !option.member.requirements.isSpecialist,
        ).toBe(false);
      }
      // «متاح N» — the free who fit: two red, one blue.
      expect(list.free).toBe(3);
    }
  });

  it('offers «قائد الطاقم» the captains, then the captain-specialists — never a specialist', () => {
    const list = slotPickList(ROSTER, ROWS, { key: LOOSE.key, slot: 'captain' }, '');
    expect(list.options.some((one) => crewRole(one.member) === 'specialist')).toBe(false);
    // Inside every part the blue ones close it: free green, free blue; away green, away blue.
    for (const section of ['free', 'seated', 'away'] as const) {
      const roles = list.options
        .filter((one) => one.section === section)
        .map((one) => crewRole(one.member));
      expect(roles.join(' ')).toBe(
        [...roles].sort((a, b) => Number(a === 'dual') - Number(b === 'dual')).join(' '),
      );
    }
  });

  it('puts the BLUE ones last OUT of the server’s order too — several, mixed among the green', () => {
    const blue = (code: string) => person(code, `أزرق ${code}`, BLUE);
    const green = (code: string) => person(code, `أخضر ${code}`, CAPTAIN);
    const red = (code: string) => person(code, `أحمر ${code}`, RED);
    const mixed = [
      blue('9001'),
      green('9002'),
      blue('9003'),
      red('9004'),
      green('9005'),
      blue('9006'),
    ];
    const captain = slotPickList(mixed, [], { key: LOOSE.key, slot: 'captain' }, '');
    expect(captain.options.map((one) => one.member.code)).toEqual([
      '9002',
      '9005',
      '9001',
      '9003',
      '9006',
    ]);
    const specialist = slotPickList(mixed, [], { key: LOOSE.key, slot: 'specialist2' }, '');
    expect(specialist.options.map((one) => one.member.code)).toEqual([
      '9004',
      '9001',
      '9003',
      '9006',
    ]);
  });

  it('walks only what can be picked, round from either end, and finds nothing in a closed list', () => {
    const list = [{ pickable: true }, { pickable: false }, { pickable: true }, { pickable: false }];
    expect(nextPickable(list, -1, 1)).toBe(0);
    expect(nextPickable(list, 0, 1)).toBe(2);
    expect(nextPickable(list, 2, 1)).toBe(0);
    expect(nextPickable(list, -1, -1)).toBe(2);
    expect(nextPickable(list, 0, -1)).toBe(2);
    expect(nextPickable([{ pickable: false }], -1, 1)).toBe(-1);
    expect(nextPickable([], -1, 1)).toBe(-1);
  });
});

// ── E — what the list draws ────────────────────────────────────────────────────────────────────────

const Parts = (props: Omit<SlotPickerProps, 'anchor' | 'trigger'>): JSX.Element => {
  const parts = useSlotPickerParts(props);
  return (
    <div>
      {parts.head}
      {parts.offers}
      {parts.searchBox}
      {parts.list}
    </div>
  );
};

const parts = (
  over: Partial<Omit<SlotPickerProps, 'anchor' | 'trigger'>> = {},
  locale: Locale = 'ar',
) =>
  render(
    <Parts
      target={{ key: LOOSE.key, slot: 'captain' }}
      slotName={t('operations.crewPlan.columns.captain', undefined, locale)}
      rowName="بدون سيارة (١)"
      sheet={false}
      members={ROSTER}
      rows={ROWS}
      ready
      seatLabel={(employeeId) => (employeeId === 'e-0100008' ? '248 · قائد الطاقم' : null)}
      onPick={() => undefined}
      onClose={() => undefined}
      {...over}
    />,
    locale,
  );

describe('E — the list, as Fleet’s «الحركة» draws its drivers', () => {
  it('says which slot of which row it fills, whom it offers in which order, and «متاح N»', () => {
    const html = parts();
    expect(html).toContain(t('operations.crewPlan.picker.title', { slot: 'قائد الطاقم' }));
    expect(html).toContain(t('operations.crewPlan.picker.row', { row: 'بدون سيارة (١)' }));
    // No tabs any more: the other pool held only people this slot refuses.
    expect(html).not.toContain('role="tab"');
    expect(html).toContain('data-picker-offers="captain"');
    expect([...html.matchAll(/data-picker-offers-role="([a-z]+)"/gu)].map((m) => m[1])).toEqual([
      'captain',
      'dual',
    ]);
    // Captains who fit and are free: 0100007 (green) and 0200011 (blue).
    expect(text(html)).toContain(
      `${t('operations.crewPlan.picker.offers')} ${t('operations.crewPlan.role.captain')} ${t('operations.crewPlan.picker.then')} ${t('operations.crewPlan.role.dual')} ${t('operations.crewPlan.picker.dualsLast')} ${t('operations.crewPlan.pools.free', { count: '٢' })}`,
    );
    // A specialist's slot offers the specialists, then the blue ones — three free of them.
    const specialist = parts({ target: { key: LOOSE.key, slot: 'specialist1' } });
    expect(specialist).toContain('data-picker-offers="specialist"');
    expect(
      [...specialist.matchAll(/data-picker-offers-role="([a-z]+)"/gu)].map((m) => m[1]),
    ).toEqual(['specialist', 'dual']);
    expect(text(specialist)).toContain(t('operations.crewPlan.pools.free', { count: '٣' }));
    // Nobody green in it: every option drawn red or blue.
    expect(specialist).not.toContain('bg-emerald-600');
  });

  it('is a combobox over a listbox: on the first that can be picked, its options named, the closed ones said', () => {
    const html = parts();
    const input = /<input[^>]*data-picker-search="true"[^>]*>/u.exec(html)?.[0] ?? '';
    expect(input).toContain('role="combobox"');
    expect(input).toContain('aria-autocomplete="list"');
    const listId = /aria-controls="([^"]+)"/u.exec(input)?.[1];
    const active = /aria-activedescendant="([^"]+)"/u.exec(input)?.[1];
    expect(html).toContain(`id="${String(listId)}" role="listbox"`);
    expect(active).toMatch(/-o-e-0100007$/u);
    expect(html).toMatch(
      new RegExp(`id="${String(active)}" role="option" aria-selected="true"`, 'u'),
    );
    expect(html.match(/role="option"[^>]*aria-disabled="true"/gu)).toHaveLength(2);
  });

  it('cuts the list in three named parts — free, on the board, away — the away ones last, with why', () => {
    const html = parts();
    expect([...html.matchAll(/data-pick-group="([a-z]+)"/gu)].map((m) => m[1])).toEqual([
      'free',
      'seated',
      'away',
    ]);
    for (const section of ['free', 'seated', 'away']) {
      expect(html).toContain(t(`operations.crewPlan.picker.section.${section}`));
    }
    const said = text(html);
    // Free — «متاح»; elsewhere — where; away — «غائب» / «إجازة», after everybody.
    expect(said).toContain(`احمد سيد بركة محمد 0100007`);
    expect(said).toContain('248 · قائد الطاقم');
    expect(said.indexOf('هاني محمد صلاح الدين')).toBeGreaterThan(said.indexOf('248 · قائد الطاقم'));
    expect(said).toContain(`هاني محمد صلاح الدين 0100016 ${t('operations.crewPlan.away.absent')}`);
    expect(said).toContain(`مصطفى حمدي سليمان 0200052 ${t('operations.crewPlan.away.onLeave')}`);
  });

  it('marks each person in his ROLE’s colour and carries his requirement icons', () => {
    const html = parts();
    const option = (code: string): string =>
      new RegExp(`data-pick-option="e-${code}"[\\s\\S]*?</div></div>`, 'u').exec(html)?.[0] ?? '';
    expect(option('0100007')).toContain('bg-emerald-600');
    expect(option('0100007')).toContain('data-flag="hasWeapon"');
    expect(option('0200011')).toContain('bg-sky-600');
  });

  it('says an empty pool is empty — and says nothing while the roster has not arrived', () => {
    expect(parts({ members: [] })).toContain(t('operations.crewPlan.pools.empty.captains'));
    expect(parts({ members: [], ready: false })).not.toContain(
      t('operations.crewPlan.pools.empty.captains'),
    );
  });

  it('reads the same in English', () => {
    const html = parts({}, 'en');
    expect(html).toContain('Choose for «Crew captain»');
    expect(text(html)).toContain('Absent');
    expect(text(html)).toContain('On leave');
  });
});

describe('E — the page: a press on the slot, the drop’s step, one list, a sheet on a phone', () => {
  const page = read('../pages/CrewBoardPage.tsx');

  it('draws «+ اختيار» in every empty slot with room, and a «+» beside a half-full slot’s ✕', () => {
    expect(page).toContain('data-slot-pick={zone}');
    expect(page).toContain('aria-haspopup="dialog"');
    expect(page).toContain('onClick={(event) => openPicker(row.key, slot, event.currentTarget)}');
    expect(page).toContain('people.length < CREW_SLOT_CAPACITY');
    expect(page).toContain('open: (from) => openPicker(row.key, slot, from)');
    // Picked up first («اختر ثم ضع هنا») is kept: then the slot offers «ضع هنا», not its list.
    expect(page).toContain('const offerList = canPlan && selected === null');
    expect(page).toContain('data-place={zone}');
    expect(translate('ar', 'operations.crewPlan.picker.choose.captain')).toBe('اختيار قائد');
    expect(translate('ar', 'operations.crewPlan.picker.choose.specialist')).toBe('اختيار أخصائي');
    // Round 34 E — the toolbar's hint that named «+ اختيار» is gone with the legend (the totals took
    // its place); the slot says it itself.
    expect(page).not.toContain("t('operations.crewPlan.hint')");
    expect(translate('ar', 'operations.crewPlan.hint')).toBe('operations.crewPlan.hint');
  });

  it('picks through the drop’s own decision and step, then puts the focus on the name just seated', () => {
    const pickInto = page.slice(page.indexOf('const pickInto ='), page.indexOf('const settleDrag'));
    expect(pickInto).toContain("decide({ kind: 'slot', key, slot }, employeeId)");
    expect(pickInto).toContain('sayRefusal(decision, employeeId)');
    expect(pickInto).toContain('place(key, slot, employeeId)');
    expect(pickInto).toContain('[data-crew-chip="${employeeId}"] button');
  });

  it('keeps ONE list for the board, closed when the slot fills, a chip is picked up or a drag starts', () => {
    expect(page.match(/<CrewSlotPicker\b/gu)).toHaveLength(1);
    expect(page).toContain('key={`${picker.key}|${picker.slot}`}');
    expect(page).toContain(
      'if (picker !== null && !hasRoom(picker.key, picker.slot)) setPicker(null);',
    );
    const select = page.slice(page.indexOf('const selectChip ='), page.indexOf('// ── The acts'));
    expect(select).toContain('setPicker(null)');
    const draw = page.slice(page.indexOf('const drawDrag ='), page.indexOf('/** The drag ended'));
    expect(draw).toContain('setPicker(null)');
  });

  it('rises as Fleet’s bottom sheet on a phone, and floats over the page on a computer', () => {
    expect(page).toContain('const phone = !useMinWidth(640);');
    expect(page).toContain('sheet={phone}');
    const picker = read('./CrewSlotPicker.tsx');
    expect(picker).toContain("from '../../fleet/components/roster/RosterBottomSheet'");
    expect(picker).toContain('createPortal(');
    expect(picker).toContain("document.addEventListener('pointerdown', away)");
    // Escape is the list's alone — the page's own (dropping a picked-up chip) must not fire too.
    expect(picker).toContain('event.stopPropagation();');
  });
});

// ── F — away that day, on the chip and the card ────────────────────────────────────────────────────

const chip = (over: Partial<Parameters<typeof CrewPlanChip>[0]> = {}): string =>
  render(
    <CrewPlanChip
      member={ROSTER[2] as OperationsCrewMemberDto}
      variant="pool"
      selected={false}
      dragging={false}
      canPlan
      onSelect={() => undefined}
      onDragStart={() => undefined}
      onDragEnd={() => undefined}
      {...over}
    />,
  );

describe('F — away that day, drawn', () => {
  it('in a pool: pale, «غائب» on it, neither dragged nor picked up — still a stop that says why', () => {
    const html = chip();
    expect(html).toContain('data-away="absent"');
    expect(html).toContain('draggable="false"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('aria-pressed');
    expect(html).toContain('bg-emerald-600/[0.12]'); // the role's colour, gone pale
    expect(html).not.toContain('bg-emerald-600 hover:bg-emerald-500');
    expect(html).toMatch(/data-away-badge="absent"[^>]*>غائب</u);
    expect(html).toContain(
      `aria-label="هاني محمد صلاح الدين — ${t('operations.crewPlan.away.why.absent')}"`,
    );
  });

  it('on a row: his colour kept, ringed and marked «إجازة», still movable — off, or on his own row', () => {
    const html = chip({
      member: ROSTER[4] as OperationsCrewMemberDto,
      variant: 'seat',
      onRemove: () => undefined,
    });
    expect(html).toContain('data-away="onLeave"');
    expect(html).toContain('draggable="true"');
    expect(html).toContain('bg-sky-600 hover:bg-sky-500');
    expect(html).toContain('outline-amber-400');
    expect(html).toMatch(/data-away-badge="onLeave"[^>]*>إجازة</u);
    expect(html).toContain('data-cell-control="remove"');
  });

  it('a seated chip ringed by the server’s refusal; a free one with nothing of the kind', () => {
    expect(
      chip({ member: ROSTER[6] as OperationsCrewMemberDto, variant: 'seat', refused: true }),
    ).toContain('data-refused="true"');
    const free = chip({ member: ROSTER[0] as OperationsCrewMemberDto });
    expect(free).not.toContain('data-away');
    expect(free).toContain('draggable="true"');
    expect(free).toContain('aria-pressed="false"');
  });

  it('gives a half-full slot’s chip the «+» beside its ✕, named for the slot and the row', () => {
    const label = t('operations.crewPlan.picker.add', { slot: 'قائد الطاقم', row: '249' });
    const html = chip({
      member: ROSTER[0] as OperationsCrewMemberDto,
      variant: 'seat',
      onRemove: () => undefined,
      onAdd: { label, open: () => undefined },
    });
    expect(html).toMatch(
      new RegExp(`data-slot-add="true" aria-haspopup="dialog" aria-label="${label}"`, 'u'),
    );
    expect(html.indexOf('data-slot-add')).toBeLessThan(html.indexOf('data-cell-control="remove"'));
    expect(chip({ member: ROSTER[0] as OperationsCrewMemberDto, variant: 'seat' })).not.toContain(
      'data-slot-add',
    );
  });

  it('the card says his day: «غائب في هذا اليوم», «في إجازة في هذا اليوم», or that HR records neither', () => {
    const line = (away: OperationsCrewAvailability | null): string =>
      text(
        render(
          <dl>
            <PlanAttendanceFact away={away} />
          </dl>,
        ),
      );
    expect(line('absent')).toBe(`${t('operations.crewPlan.card.attendance')} غائب في هذا اليوم`);
    expect(line('onLeave')).toBe(
      `${t('operations.crewPlan.card.attendance')} في إجازة في هذا اليوم`,
    );
    expect(line(null)).toBe(
      `${t('operations.crewPlan.card.attendance')} ${t('operations.crewPlan.card.attendanceNone')}`,
    );
    const card = render(
      <PlanMemberCardBody
        member={ROSTER[2] as OperationsCrewMemberDto}
        mayReadCrew
        seat={null}
        attendance={<PlanAttendanceFact away="absent" />}
      />,
    );
    expect(card).toContain('data-plan-member-away="absent"');
    // The chip hands its card that line itself.
    expect(read('./CrewPlanChip.tsx')).toContain('attendance: <PlanAttendanceFact away={away} />');
  });

  it('says the server’s refusal in both languages, and the page names him on his row', () => {
    const failure = new ApiError('OPERATIONS_CREW_MEMBER_ABSENT', 'away', 422);
    expect(errorMessage(failure, 'ar')).toBe('على أحد الصفوف غائب أو من في إجازة في هذا اليوم.');
    expect(errorMessage(failure, 'en')).toBe(
      'Somebody on a row is absent or on leave on this day.',
    );
    const page = read('../pages/CrewBoardPage.tsx');
    expect(page).toContain('t(`operations.crewPlan.refused.${placed.person.reason}`, {');
    expect(page).toContain('refusal.person?.employeeId === employeeId');
    expect(t('operations.crewPlan.refused.absent', { name: 'عمرو' })).toBe(
      'عمرو غائب في هذا اليوم — أخرِجه من هذا الصف.',
    );
  });

  it('leaves him off the standing crew and refuses a van to a row he is on — both said, by name', () => {
    const page = read('../pages/CrewBoardPage.tsx');
    const standing = page.slice(
      page.indexOf('const toggleStanding ='),
      page.indexOf('const giveVan ='),
    );
    // The day's filter is `standingForDay` (lib/crew-plan.ts, pinned there): away, or not his slot.
    expect(standing).toContain('standingForDay(standingSources, memberOf)');
    expect(read('../lib/crew-plan.ts')).toContain('if (awayOf(member) !== null) {');
    expect(standing).toContain("t('operations.crewPlan.standingAway')");
    const van = page.slice(page.indexOf('const giveVan ='), page.indexOf('const exportExcel ='));
    expect(van).toContain("t('operations.crewPlan.vanAway')");
    expect(van).toContain('return;');
    // Round 24 — the van comes from the board's «بدون سيارة» list (every car with no crew).
    expect(page).toContain('if (row !== undefined) giveVan(row, choice);');
  });

  it('reads the pool for the board’s own day — never «no day», which the server answers for today', () => {
    // The default board is TOMORROW; the roster asked without a date is TODAY. Absent / on leave is
    // a fact about one day, so the pool must be asked for the day the board shows (and the save checks).
    const page = read('../pages/CrewBoardPage.tsx');
    expect(page).toContain("const day = date ?? (board.data?.date ?? '').slice(0, 10);");
    expect(page).toContain("useOperationsCrewDirectory(day === '' ? null : day, day !== '')");
    expect(page).not.toContain('useOperationsCrewDirectory(date)');
    expect(page.indexOf('const day = date')).toBeLessThan(
      page.indexOf('useOperationsCrewDirectory('),
    );
  });
});

// ── Round 23 — a seat held outside one's role, and the save's refusal ───────────────────────────────

describe('Round 23 — a seat held from before the rule is marked, never removed', () => {
  const held = (why: 'notCaptain' | 'notSpecialist') => ({
    why,
    badge: t(`operations.crewPlan.wrongSlot.badge.${why}`),
    reason: t(`operations.crewPlan.wrongSlot.held.${why}`),
  });

  it('rings the chip in dashed amber with the word and the reason — still movable, still removable', () => {
    const html = chip({
      member: ROSTER[0] as OperationsCrewMemberDto,
      variant: 'seat',
      onRemove: () => undefined,
      wrongSlot: held('notSpecialist'),
    });
    expect(html).toContain('data-wrong-slot="notSpecialist"');
    expect(html).toContain('outline-dashed');
    expect(html).toContain('outline-amber-400');
    expect(html).toMatch(/data-wrong-slot-badge="notSpecialist"[^>]*>ليس أخصائيًا</u);
    expect(html).toContain(`title="${t('operations.crewPlan.wrongSlot.held.notSpecialist')}"`);
    // The reason is in the chip's own name for a screen reader.
    expect(html).toContain(t('operations.crewPlan.wrongSlot.held.notSpecialist'));
    expect(html).toContain('draggable="true"');
    expect(html).toContain('data-cell-control="remove"');
    // The colour stays the role's — he is still a captain, in the wrong seat.
    expect(html).toContain('bg-emerald-600 hover:bg-emerald-500');
  });

  it('says «ليس قائدًا» for a specialist in the captain’s slot, and nothing on a chip that fits', () => {
    const red = chip({
      member: ROSTER[5] as OperationsCrewMemberDto,
      variant: 'seat',
      wrongSlot: held('notCaptain'),
    });
    expect(red).toMatch(/data-wrong-slot-badge="notCaptain"[^>]*>ليس قائدًا</u);
    const fits = chip({ member: ROSTER[0] as OperationsCrewMemberDto, variant: 'seat' });
    expect(fits).not.toContain('data-wrong-slot');
    // The Round-20 quiet dot is gone with the «marked, not refused» it stood for.
    expect(fits).not.toContain('data-out-of-role');
  });

  it('the page marks exactly the seats the rule refuses — by the contracts’ own `fitsCrewSlot`', () => {
    const page = read('../pages/CrewBoardPage.tsx');
    expect(page).toContain('? wrongSlotOf(crewRoleOf(member.requirements), slot)');
    // Not for somebody the roster no longer names — his requirements cannot be read.
    expect(page).toContain('const wrong = byId.has(employeeId)');
    expect(page).toContain('badge: t(`operations.crewPlan.wrongSlot.badge.${wrong}`)');
    expect(page).toContain('reason: t(`operations.crewPlan.wrongSlot.held.${wrong}`)');
    expect(page).not.toContain('outOfRole');
  });

  it('says the server’s refusal in both languages, and rings him on the row it names', () => {
    const failure = new ApiError('OPERATIONS_CREW_MEMBER_WRONG_SLOT', 'wrong slot', 422);
    expect(errorMessage(failure, 'ar')).toBe(
      'عُيِّن أحدهم في خانة لا تناسبه — قائد في خانة أخصائي، أو أخصائي في خانة القائد.',
    );
    expect(errorMessage(failure, 'en')).toContain('captain in a specialist’s slot');
    const page = read('../pages/CrewBoardPage.tsx');
    expect(page).toContain("(refusal?.field === 'crew' || refusal?.field === 'slot') &&");
    expect(t('operations.crewPlan.refused.notSpecialist', { name: 'أحمد' })).toBe(
      'أحمد قائد فقط — أخرِجه من خانة الأخصائي في هذا الصف.',
    );
  });
});

describe('Round 23 — «الطاقم الثابت»: the same slot rule, and the captain-specialists last', () => {
  const page = read('../pages/StandingCrewPage.tsx');

  it('refuses a drop into a slot the person’s role does not fit, in the day board’s own words', () => {
    // Round 27 — the board's twin: every way of seating somebody asks the board's own rule
    // (`resolveDrop`, which refuses a slot his role does not fit), and a refusal is said by the
    // board's own words, «لا يُعيَّن …» then whom the slot takes.
    expect(page).toContain(
      'target === null ? null : resolveDrop(rows, target, employeeId, roleOf(employeeId), null);',
    );
    const drop = page.slice(page.indexOf('onDrop: (event) => {'), page.indexOf(': {};'));
    expect(drop).toContain('decide(targetAt(event.target), employeeId)');
    expect(drop).toContain('sayRefusal(decision, employeeId)');
    const say = page.slice(page.indexOf('const sayRefusal ='), page.indexOf('const phone ='));
    expect(say).toContain('t(`operations.crewPlan.drop.${decision.reason}`, vars)');
    expect(say).toContain('`operations.crewPlan.drop.${decision.reason}Why`');
    // A captain moving with his crew leaves behind a companion the slot no longer fits.
    expect(page).toContain('(current) => placeWithCrew(current, key, slot, employeeId, fits).rows');
    expect(page).toContain('fitsCrewSlot(roleOf(employeeId), slot)');
  });

  it('says the save’s slot refusal in its own words', () => {
    expect(page).toContain("failure.code === 'OPERATIONS_CREW_MEMBER_WRONG_SLOT'");
    expect(page).toContain('errorMessage(failure, locale)');
  });
});
