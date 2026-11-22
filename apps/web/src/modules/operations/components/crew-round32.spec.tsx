// Round 32 — «لوحة التشغيلة» and «الطاقم الثابت».
//
//   A. «دى مشكلة بيظهر عربيات ايه الاصفار دى» — both van pickers opened on «0», «00», «000», «0000»,
//      «00000», then «61» (the owner's two screenshots). A car whose Fleet code names nothing is now
//      listed LAST, in «سيارات بلا كود في الأسطول», by its plate and its make — never a bare «0000» —
//      and found by its plate; the cars nothing names (code and plate) are counted on the list's last
//      line, not listed; codes in number order (61, 101, 150 …).
//   B. «لما بجيب السجل فى لوحة التشغيل بيخلى اعدل وانا عاوزها اظهار فقط» — a past day opens as the
//      board's RECORD (`isCrewRecord`): every act shut, a calm notice, «العودة إلى اليوم».
//
// The suite runs in node with no DOM: the list is rendered through its phone sheet (the portal made
// a plain child), the page is read as source.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import {
  ErrorCodes,
  type Locale,
  type MeDto,
  type OperationsCrewBoardFreeVehicleDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { translate } from '../../../platform/localization/i18n';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { vehiclelessRow, type PlanRow } from '../lib/crew-plan';
import { isCrewRecord } from '../lib/crew-record';
import { searchVehicleChoices, vehicleChoices, type VehicleChoice } from '../lib/crew-vehicles';
import { standingVehicleChoices } from '../lib/standing-crew';
import { CrewVehiclePicker } from './CrewVehiclePicker';

(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const t = (key: string, vars?: Record<string, string>, locale: Locale = 'ar'): string =>
  translate(locale, key, vars);
const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const free = (
  vehicleId: string,
  vehicleCode: string,
  over: Partial<OperationsCrewBoardFreeVehicleDto> = {},
): OperationsCrewBoardFreeVehicleDto => ({
  vehicleId,
  vehicleCode,
  group: 'other',
  onRoster: false,
  inWorkshop: false,
  drivers: [],
  uncoded: null,
  ...over,
});
const HIACE = { ar: 'تويوتا هاي إس', en: 'Toyota HiAce' };

/** The owner's board: a row without a van, and the server's list — the coded cars, and two zeros. */
const LOOSE: PlanRow = { ...vehiclelessRow(1), key: 'loose:c-1', crewId: 'c-1' };
const FREE = [
  free('v-61', '61', { group: 'standing' }),
  free('v-101', '101', { group: 'standing' }),
  free('v-9', '9'),
  free('v-150', '150'),
  free('v-213', '213'),
  free('v-0', '0', {
    group: 'uncoded',
    uncoded: { plateNumber: 'ن ق ل 4521', typeName: HIACE },
  }),
  free('v-00', '00', { group: 'uncoded', uncoded: { plateNumber: 'ب ط 118', typeName: null } }),
];

describe('A — the board’s «بدون سيارة» list: no bare «0000», codes in number order', () => {
  const choices = vehicleChoices([LOOSE], [LOOSE], FREE, LOOSE.key);

  it('lists the coded cars by number — 61 before 101, 9 before 150 — and the uncoded LAST, by their plate', () => {
    expect(choices.map((one) => one.vehicleCode)).toEqual([
      '61',
      '101',
      '9',
      '150',
      '213',
      '0',
      '00',
    ]);
    expect(choices.slice(-2).map((one) => one.group)).toEqual(['uncoded', 'uncoded']);
    expect(choices.at(-2)?.uncoded).toEqual({ plateNumber: 'ن ق ل 4521', typeName: HIACE });
    expect(choices.find((one) => one.vehicleCode === '61')?.uncoded).toBeNull();
    // Picked as any car: the row takes it where it stands.
    expect(choices.at(-1)).toMatchObject({ pickable: true, vanKey: null, onRoster: false });
  });

  it('even arriving out of order (a text sort put «0» … «00000» first, then «61»)', () => {
    const shuffled = [...FREE].reverse();
    expect(
      vehicleChoices([LOOSE], [LOOSE], shuffled, LOOSE.key).map((one) => one.vehicleCode),
    ).toEqual(['61', '101', '9', '150', '213', '0', '00']);
  });

  it('keeps a ROSTER van whose code names nothing in the roster’s group — named by its plate', () => {
    const van: PlanRow = {
      ...vehiclelessRow(2),
      key: 'van:v-00000',
      vehicleId: 'v-00000',
      vehicleCode: '00000',
      onRoster: true,
      crewId: null,
    };
    const list = vehicleChoices(
      [LOOSE, van],
      [LOOSE, van],
      [
        free('v-00000', '00000', {
          group: 'roster',
          onRoster: true,
          uncoded: { plateNumber: '00', typeName: null },
        }),
        ...FREE,
      ],
      LOOSE.key,
    );
    expect(list[0]).toMatchObject({ vehicleCode: '00000', group: 'roster', vanKey: 'van:v-00000' });
    expect(list[0]?.uncoded?.plateNumber).toBe('00');
  });

  it('finds an uncoded car by its plate — and never by its zeros («0» is the start of a code)', () => {
    expect(searchVehicleChoices(choices, '4521').map((one) => one.vehicleId)).toEqual(['v-0']);
    expect(searchVehicleChoices(choices, 'ب ط').map((one) => one.vehicleId)).toEqual(['v-00']);
    // «٤٥٢١» typed on an Arabic keyboard is the same plate.
    expect(searchVehicleChoices(choices, '٤٥٢١').map((one) => one.vehicleId)).toEqual(['v-0']);
    expect(searchVehicleChoices(choices, '0').map((one) => one.vehicleCode)).not.toContain('0');
    expect(searchVehicleChoices(choices, '00').map((one) => one.vehicleCode)).not.toContain('00');
    expect(searchVehicleChoices(choices, '61').map((one) => one.vehicleCode)).toEqual(['61']);
  });
});

describe('A — «الطاقم الثابت»’s «إضافة سيارة» list', () => {
  const available = [
    { vehicleId: 'v-101', vehicleCode: '101', uncoded: null },
    { vehicleId: 'v-0', vehicleCode: '0', uncoded: { plateNumber: 'ن ق ل 4521', typeName: HIACE } },
    { vehicleId: 'v-61', vehicleCode: '61', uncoded: null },
    { vehicleId: 'v-00', vehicleCode: '00', uncoded: { plateNumber: 'ب ط 118', typeName: null } },
  ];

  it('lists the coded in number order, then the uncoded in their own group, last', () => {
    const list = standingVehicleChoices([], [], available, false);
    expect(list.map((one) => one.vehicleCode)).toEqual(['61', '101', '0', '00']);
    expect(list.map((one) => one.group)).toEqual(['other', 'other', 'uncoded', 'uncoded']);
    expect(list[2]?.uncoded?.plateNumber).toBe('ن ق ل 4521');
    // Narrowed to the cash-transfer vehicles: the coded under that heading; the uncoded still last.
    expect(standingVehicleChoices([], [], available, true).map((one) => one.group)).toEqual([
      'cashTransfer',
      'cashTransfer',
      'uncoded',
      'uncoded',
    ]);
  });

  it('a vehicle taken out here is listed as the standing crew held it — a zero code after the coded', () => {
    const held: PlanRow = {
      ...vehiclelessRow(3),
      key: 'van:v-000',
      vehicleId: 'v-000',
      vehicleCode: '000',
      crewId: 's-1',
    };
    const list = standingVehicleChoices([], [held], available, false);
    expect(list.filter((one) => one.group === 'other').map((one) => one.vehicleCode)).toEqual([
      '61',
      '101',
      '000',
    ]);
  });
});

const render = (choices: readonly VehicleChoice[], unidentified: number, locale: Locale = 'ar') =>
  renderToStaticMarkup(
    <Provider
      store={configureStore({
        reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
        preloadedState: {
          locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
          auth: {
            me: { id: 'u1', permissions: {} } as unknown as MeDto,
            status: 'signedIn' as const,
          },
        },
      })}
    >
      <CrewVehiclePicker
        rowKey={LOOSE.key}
        rowName="بدون سيارة (1)"
        anchor={{ current: null }}
        trigger={{ current: null }}
        sheet
        choices={choices}
        unidentified={unidentified}
        onPick={() => undefined}
        onClose={() => undefined}
      />
    </Provider>,
  );

describe('A — the list, as drawn', () => {
  const choices = vehicleChoices([LOOSE], [LOOSE], FREE, LOOSE.key);

  it('names an uncoded car by its plate, a quiet «بلا كود» and its make — never its zeros', () => {
    const html = render(choices, 0);
    const option = html.slice(html.indexOf('data-vehicle-option="v-0"'));
    const drawn = text(option.slice(0, option.indexOf('</div>', option.indexOf('</span></span>'))));
    expect(drawn).toContain('ن ق ل 4521');
    expect(drawn).toContain(t('operations.crewPlan.vehicles.noCode'));
    expect(drawn).toContain('تويوتا هاي إس');
    expect(drawn).not.toMatch(/(^|\s)0(\s|$)/u);
    expect(html).toContain('data-vehicle-uncoded="true"');
    // A screen reader hears the plate and the make, and that it has no code.
    expect(html).toContain(
      `aria-label="${t('operations.crewPlan.vehicles.uncodedLabel', { plate: 'ن ق ل 4521', make: 'تويوتا هاي إس' })}"`,
    );
    // Its make in English on the English screen.
    expect(text(render(choices, 0, 'en'))).toContain('Toyota HiAce');
  });

  it('puts them under their own heading, LAST — after every coded car', () => {
    const html = render(choices, 0);
    expect(html).toContain('data-vehicle-section="uncoded"');
    expect(text(html)).toContain(t('operations.crewPlan.vehicles.group.uncoded'));
    expect(html.indexOf('data-vehicle-section="uncoded"')).toBeGreaterThan(
      html.indexOf('data-vehicle-option="v-213"'),
    );
    // A coded car is drawn by its code, as before.
    expect(html.slice(html.indexOf('data-vehicle-option="v-61"'))).toMatch(/^[^]*?>61</u);
  });

  it('says how many cars nothing names — and where they are put right — on its last line', () => {
    const html = render(choices, 3);
    expect(html).toContain('data-vehicle-unidentified="3"');
    expect(text(html)).toContain(
      t('operations.crewPlan.vehicles.unidentified', { count: '٣' }).split(':')[0] ?? '',
    );
    expect(text(html)).toContain('«الحركة» ← «السيارات»');
    expect(render(choices, 0)).not.toContain('data-vehicle-unidentified');
  });

  it('both screens hand the list the server’s count', () => {
    expect(read('../pages/CrewBoardPage.tsx')).toContain(
      'unidentified={board.data?.unidentifiedVehicles ?? 0}',
    );
    expect(read('../pages/StandingCrewPage.tsx')).toContain(
      'unidentified={standing.data?.unidentifiedVehicles ?? 0}',
    );
  });
});

describe('B — a past day is the board’s record (`isCrewRecord`)', () => {
  const read32 = (today: string, past: boolean, arrivedOn: string) => ({
    board: { today: `${today}T00:00:00.000Z`, past },
    arrivedAt: Date.parse(`${arrivedOn}T10:00:00.000Z`),
  });

  it('before the read: the URL’s day against today on this screen', () => {
    expect(isCrewRecord('2026-11-21', '2026-11-22', null)).toBe(true);
    expect(isCrewRecord('2026-11-22', '2026-11-22', null)).toBe(false);
    expect(isCrewRecord('2026-11-23', '2026-11-22', null)).toBe(false);
    // No day yet (the default board waits for the server to name tomorrow): nothing to judge.
    expect(isCrewRecord('', '2026-11-22', null)).toBe(false);
  });

  it('once read, the SERVER decides — a PC clock a day ahead never turns today into a record', () => {
    expect(isCrewRecord('2026-11-21', '2026-11-22', read32('2026-11-22', true, '2026-11-22'))).toBe(
      true,
    );
    // The PC says the 23rd; the server, read today, says the 22nd is not past.
    expect(
      isCrewRecord('2026-11-22', '2026-11-23', read32('2026-11-22', false, '2026-11-23')),
    ).toBe(false);
  });

  it('a board of today left open past midnight is yesterday’s record in the morning; tomorrow’s is today’s', () => {
    expect(
      isCrewRecord('2026-11-22', '2026-11-23', read32('2026-11-22', false, '2026-11-22')),
    ).toBe(true);
    expect(
      isCrewRecord('2026-11-23', '2026-11-23', read32('2026-11-22', false, '2026-11-22')),
    ).toBe(false);
  });
});

describe('B — the page on a record', () => {
  const page = read('../pages/CrewBoardPage.tsx');

  it('shuts every act through ONE gate: whoever may plan, on a day that is not a record', () => {
    expect(page).toContain("const mayPlan = can('operationsCrew.plan');");
    expect(page).toContain('const canPlan = mayPlan && !isRecord;');
    // The grant is read nowhere else: every act — drop, list, van, row, box, standing crew, undo,
    // save — asks `canPlan`.
    expect(page.match(/mayPlan/gu)?.length).toBe(2);
    expect(page).not.toContain("can('operationsCrew.plan') &&");
    // What a record shuts, each behind `canPlan` (as for a reader without the grant).
    for (const act of [
      'data-standing-toggle="true"',
      'data-add-loose-row="true"',
      'data-crew-plan-discard="true"',
      'data-crew-plan-save=',
    ]) {
      const at = page.indexOf(act);
      expect(page.lastIndexOf('{canPlan && (', at), act).toBeGreaterThan(-1);
    }
    expect(page).toContain('> = canPlan\n    ? {');
    expect(page).toContain('if (!canPlan || lastOperation === null || undoWords === null) return;');
    expect(page).toContain('const canAddArea = canPlan && can(');
  });

  it('draws what the server holds — never a draft — and says work the day ended on', () => {
    expect(page).toContain('const rows = isRecord ? serverRows : history.now.rows;');
    expect(page).toContain(
      'const lostOnRecord = isRecord ? changeCount(planChanges(history.now.rows, serverRows)) : 0;',
    );
    expect(page).toContain("t('operations.crewPlan.record.unsavedTitle')");
  });

  it('a calm notice, the mark, and «العودة إلى اليوم» where the acts were; the day box keeps the past', () => {
    expect(page).toContain('<RecordNotice');
    expect(page).toContain("title={t('operations.crewPlan.record.title', {");
    expect(page).toContain('data-crew-record-mark="true"');
    expect(page).toContain('onClick={() => setDay(liveToday)}');
    expect(page).toContain(
      '<DayBox label={t(\'operations.crewPlan.day\')} value={day} min="" onChange={setDay} />',
    );
    // The type colours open read only on a record.
    expect(page).toContain('canEdit={canColourTypes && !isRecord}');
  });

  it('says it in both languages — and the server’s refusal too', () => {
    expect(t('operations.crewPlan.record.title', { day: '2026-11-21' })).toBe(
      'سجل يوم 2026-11-21 — للعرض فقط، لا يمكن التعديل',
    );
    expect(t('operations.crewPlan.record.today')).toBe('العودة إلى اليوم');
    expect(t('operations.crewPlan.record.mark', undefined, 'en')).toBe('Record · view only');
    const refused = new ApiError(ErrorCodes.OPERATIONS_CREW_DAY_IN_PAST, 'x', 422);
    expect(errorMessage(refused, 'ar')).toBe(
      'هذا اليوم قد مضى — لوحته سجل للعرض فقط. خطِّط لليوم أو ليوم لاحق.',
    );
    expect(errorMessage(refused, 'en')).toContain('its board is a record, view only');
  });
});
