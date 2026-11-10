// The «تعيين السيارات» pieces BOTH boards draw — the driver lists and the unsaved bar — rendered
// with `renderToStaticMarkup` for the markup contracts the board specs and the dashboard links
// read: the employee ids on the rows, the drag source on a free row, the licence block's own
// marker, and every figure in Latin digits.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { type FleetPersonDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import { authSlice } from '../../../../store/authSlice';
import { translate } from '../../../../platform/localization/i18n';
import { type DriverOption, type DriverOptions } from '../../lib/roster-board';
import { AvailableList, DriverTabs, UnavailableList } from './roster-drivers';
import { EditsBar, num, slashDate, unbrokenName, weekdayOf } from './roster-parts';

const E1 = '650000000000000000000011';
const E2 = '650000000000000000000012';
const E3 = '650000000000000000000013';
const E4 = '650000000000000000000014';
const E5 = '650000000000000000000015';

const PEOPLE = new Map<string, FleetPersonDto>(
  (
    [
      [E1, 'أحمد محمد', '11001'],
      [E2, 'محمد محمود', '11002'],
      [E3, 'سعيد سعد', '11003'],
      [E4, 'كريم علي', '11004'],
      [E5, 'عمرو حسن', '11005'],
    ] as const
  ).map(([employeeId, fullNameAr, code]) => [
    employeeId,
    {
      employeeId,
      code,
      fullNameAr,
      status: 'active',
      branchId: null,
      address: null,
      governorate: null,
      phone: null,
      hiredAt: null,
    } as unknown as FleetPersonDto,
  ]),
);
const person = (employeeId: string): FleetPersonDto | undefined => PEOPLE.get(employeeId);

const option = (employeeId: string, over: Partial<DriverOption> = {}): DriverOption => ({
  employeeId,
  state: 'free',
  seatedCode: null,
  onTarget: false,
  licenceExpired: false,
  ...over,
});

/** E3 free; E4 flagged and free; E5 flagged and seated on 154; E1 seated on 150 (a move). */
const OPTIONS: DriverOptions = {
  free: [option(E3)],
  flagged: [
    option(E4, { licenceExpired: true }),
    option(E5, { licenceExpired: true, state: 'seated', seatedCode: '154' }),
  ],
  seated: [option(E1, { state: 'seated', seatedCode: '150' })],
};
const LICENCE = {
  count: 2,
  links: { drivers: '/fleet/drivers?licExpBefore=2026-11-09', vehicles: null, vehiclesCount: 1 },
};

const store = configureStore({
  reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
  preloadedState: {
    locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
    auth: { me: { id: 'u1', permissions: {} } as unknown as MeDto, status: 'signedIn' as const },
  },
});
const render = (node: JSX.Element): string =>
  renderToStaticMarkup(
    <Provider store={store}>
      <MemoryRouter>{node}</MemoryRouter>
    </Provider>,
  );
const t = (key: string, params?: Record<string, string | number>): string =>
  translate('ar', key, params);

/** From `marker` to the end of the element that carries it (the next `</li>`). */
const item = (markup: string, marker: string): string => {
  const at = markup.indexOf(marker);
  if (at === -1) return '';
  return markup.slice(markup.lastIndexOf('<li', at), markup.indexOf('</li>', at));
};

const ARABIC_INDIC = /[٠-٩]/u;

describe('AvailableList — the pool and the licence block', () => {
  const desk = (part: 'list' | 'licence'): string =>
    render(
      <AvailableList
        options={OPTIONS}
        person={person}
        onPick={null}
        licence={LICENCE}
        dayHasDrivers
        searched={false}
        draggable
        part={part}
      />,
    );

  it('makes a free driver the pool’s card, a drag source right where the card starts', () => {
    const markup = desk('list');
    const at = markup.indexOf(`data-driver-card="${E3}"`);
    expect(at).toBeGreaterThan(-1);
    expect(markup.slice(at, at + 200)).toContain('draggable="true"');
    expect(markup, 'the name and the code').toContain('سعيد سعد');
    expect(markup).toContain('11003');
  });

  it('makes a free driver a drag source and nothing more on the computer — no button, no Tab stop', () => {
    // No seat is being filled and nobody is chosen first there: a `<button aria-pressed>` would be
    // a Tab stop per driver, announced as a toggle that does nothing. The keyboard's way onto a
    // seat is the seat's «+ اختيار سائق».
    const markup = desk('list');
    const free = item(markup, `data-driver-card="${E3}"`);
    expect(free).toContain('draggable="true"');
    expect(free).not.toContain('<button');
    expect(markup).not.toContain('aria-pressed');
    const licence = item(desk('licence'), `data-licence-expired-driver="${E4}"`);
    expect(licence, 'nor is an unseated flagged driver').not.toContain('<button');
    expect(licence).toContain('draggable="true"');
  });

  it('keeps the licence block on a day with nobody available — the vehicles still have their check', () => {
    const empty: DriverOptions = { free: [], flagged: [], seated: [] };
    const none = { ...LICENCE, count: 0 };
    const all = render(
      <AvailableList
        options={empty}
        person={person}
        onPick={null}
        licence={none}
        dayHasDrivers={false}
        searched={false}
      />,
    );
    expect(all).toContain(t('fleet.roster.availableEmpty'));
    expect(all).toContain('data-licence-expired-panel="true"');
    expect(all.indexOf(t('fleet.roster.availableEmpty'))).toBeLessThan(
      all.indexOf('data-licence-expired-panel'),
    );
    expect(all).toContain('data-licence-check="drivers"');
    const pinned = render(
      <AvailableList
        options={empty}
        person={person}
        onPick={null}
        licence={none}
        dayHasDrivers={false}
        searched={false}
        draggable
        part="licence"
      />,
    );
    expect(pinned).toContain('data-licence-expired-panel="true"');
    expect(pinned, 'the block alone').not.toContain(t('fleet.roster.availableEmpty'));
  });

  it('leaves the licence block out of the list — the computer pins it apart', () => {
    const markup = desk('list');
    expect(markup).not.toContain('data-licence-expired-panel');
    expect(markup).not.toContain(`data-driver-card="${E4}"`);
  });

  it('draws the block: its marker, the count, each flagged driver, the seated one’s car', () => {
    const markup = desk('licence');
    expect(markup).toContain('data-licence-expired-panel="true"');
    expect(markup).toContain(t('fleet.roster.expiredLicence.title', { count: '2' }));
    expect(
      item(markup, `data-licence-expired-driver="${E4}"`),
      'unseated: still draggable',
    ).toContain('draggable="true"');
    const seated = item(markup, `data-licence-expired-driver="${E5}"`);
    expect(seated, 'seated: says where').toContain(
      t('fleet.roster.expiredLicence.seatedOn', { code: '154' }),
    );
    expect(seated, 'and is not dragged from here').not.toContain('draggable="true"');
    expect(markup, 'a licence row is not the pool’s card').not.toContain('data-driver-card');
    expect(markup).toContain('data-licence-check="drivers"');
    expect(markup, 'the vehicles check needs its own grant').not.toContain(
      'data-licence-check="vehicles"',
    );
  });

  it('lists the drivers on OTHER cars apart, with that car’s code — never as the pool', () => {
    const markup = render(
      <AvailableList
        options={OPTIONS}
        person={person}
        onPick={() => undefined}
        licence={null}
        dayHasDrivers
        searched={false}
      />,
    );
    expect(markup).toContain(t('fleet.roster.onOtherVehicles'));
    const moved = item(markup, `data-seated-driver="${E1}"`);
    expect(moved).toContain('>150<');
    expect(markup).not.toContain(`data-driver-card="${E1}"`);
  });

  it('shows a reader who only looks rows, not buttons — nothing to drag, nothing to press', () => {
    const markup = render(
      <AvailableList
        options={OPTIONS}
        person={person}
        onPick={null}
        licence={LICENCE}
        dayHasDrivers
        searched={false}
      />,
    );
    expect(markup).toContain(`data-driver-card="${E3}"`);
    expect(markup).not.toContain('draggable="true"');
    expect(markup).not.toContain('<button');
  });

  it('says why the list is empty — the day, or the term', () => {
    const empty = { free: [], flagged: [], seated: [] };
    const day = render(
      <AvailableList
        options={empty}
        person={person}
        onPick={null}
        licence={null}
        dayHasDrivers
        searched={false}
      />,
    );
    expect(day).toContain(t('fleet.roster.availableEmpty'));
    const term = render(
      <AvailableList
        options={empty}
        person={person}
        onPick={null}
        licence={null}
        dayHasDrivers
        searched
      />,
    );
    expect(term).toContain(t('fleet.fixedRoster.driverSearchEmpty'));
  });

  it('writes no figure in Arabic-Indic digits', () => {
    expect(desk('list') + desk('licence')).not.toMatch(ARABIC_INDIC);
  });
});

describe('UnavailableList — the reasons and who is out', () => {
  const list = (drivers: { employeeId: string; reason: string }[], reasons: string[]): string =>
    render(
      <UnavailableList
        drivers={drivers}
        person={person}
        chips={[
          { reason: 'hrLeave', count: 1 },
          { reason: 'licenceExpired', count: 0 },
        ]}
        reasons={reasons}
        onToggleReason={() => undefined}
        searched={false}
        dayHasAny
      />,
    );

  it('lists each driver with his reason, never as a drag source', () => {
    const markup = list([{ employeeId: E2, reason: 'hrLeave' }], []);
    const row = item(markup, `data-unavailable-driver="${E2}"`);
    expect(row).toContain(t('fleet.roster.reason.hrLeave'));
    expect(row).not.toContain('draggable');
  });

  it('draws the reason chips as one group, a pressed chip kept at 0', () => {
    const markup = list([], ['licenceExpired']);
    expect(markup).toContain(`role="group" aria-label="${t('fleet.roster.reasonFilter')}"`);
    const chip = markup.slice(markup.indexOf('data-reason-filter="licenceExpired"'));
    expect(chip.slice(0, chip.indexOf('</button>'))).toMatch(/aria-pressed="true"[\s\S]*>0</u);
    expect(markup, 'emptied by the chips alone').toContain(t('fleet.roster.reasonFilterEmpty'));
    expect(markup).not.toMatch(ARABIC_INDIC);
  });

  it('shows a reason this build does not know as sent', () => {
    expect(list([{ employeeId: E2, reason: 'somethingNewer' }], [])).toContain('somethingNewer');
  });
});

describe('DriverTabs — the two halves', () => {
  it('names both halves with their counts in Latin digits', () => {
    const markup = render(
      <DriverTabs
        tab="available"
        onTab={() => undefined}
        availableCount={12}
        unavailableCount={3}
      />,
    );
    const available = markup.slice(markup.indexOf('data-driver-tab="available"'));
    expect(available.slice(0, available.indexOf('</button>'))).toContain('>12<');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain(t('fleet.roster.unavailableTitle'));
    expect(markup).not.toMatch(ARABIC_INDIC);
  });
});

describe('EditsBar — what is unsaved, and the three answers to it', () => {
  const bar = (edited: boolean, undoable: boolean, shape: 'phone' | 'floating'): string =>
    render(
      <EditsBar
        codes={edited ? ['150', '247'] : []}
        edited={edited}
        undoable={undoable}
        saving={false}
        onUndo={() => undefined}
        onDiscard={() => undefined}
        onSave={() => undefined}
        onCode={() => undefined}
        shape={shape}
      />,
    );
  const disabled = (markup: string, marker: string): boolean => {
    const at = markup.indexOf(marker);
    const tag = markup.slice(markup.lastIndexOf('<button', at), markup.indexOf('>', at) + 1);
    return / disabled=""/u.test(tag);
  };

  it('on a day with only a projected operation: «حفظ» live, nothing to undo or discard', () => {
    const markup = bar(false, false, 'floating');
    expect(markup).toContain('data-unsaved="true"');
    expect(disabled(markup, 'data-save-roster="true"')).toBe(false);
    expect(disabled(markup, 'data-undo-edit="true"')).toBe(true);
    expect(disabled(markup, 'data-discard-edits="true"')).toBe(true);
    expect(markup).not.toContain('data-edited-code');
  });

  it('after edits: the edited cars, «تراجع» and «إلغاء» live, in both shapes', () => {
    for (const shape of ['phone', 'floating'] as const) {
      const markup = bar(true, true, shape);
      expect(markup).toContain('data-edited-code="150"');
      expect(markup).toContain('data-edited-code="247"');
      expect(markup).toContain(t('fleet.roster.undo'));
      expect(disabled(markup, 'data-undo-edit="true"')).toBe(false);
      expect(disabled(markup, 'data-discard-edits="true"')).toBe(false);
    }
    expect(bar(true, true, 'floating'), 'the tablet and computer name them').toContain(
      t('fleet.roster.editedCars'),
    );
  });
});

describe('the day and the figures', () => {
  it('writes the day with slashes and its weekday from Intl, in either language', () => {
    expect(slashDate('2026-11-09')).toBe('2026/11/09');
    expect(weekdayOf('2026-11-09', 'ar')).toBe('الاثنين');
    expect(weekdayOf('2026-11-09', 'en')).toBe('Monday');
    expect(weekdayOf('nonsense', 'ar'), 'a hand-typed date that does not parse').toBe('');
  });

  it('writes every figure in Latin digits', () => {
    expect(num(1234)).toBe('1,234');
    expect(num(8)).toBe('8');
  });
});

describe('unbrokenName — «عبد» and «أبو» never end a line', () => {
  const NBSP = '\u00a0';
  it.each([
    ['عمرو حسن عبد الله', `عمرو حسن عبد${NBSP}الله`],
    ['ياسر عبد العزيز سالم', `ياسر عبد${NBSP}العزيز سالم`],
    ['أبو عبد الله', `أبو${NBSP}عبد${NBSP}الله`],
    ['عبد الله فتحي زايد', `عبد${NBSP}الله فتحي زايد`],
    ['  أحمد   محمد ', 'أحمد محمد'],
    ['عبدالله محمد', 'عبدالله محمد'],
    ['', ''],
  ])('«%s»', (name, shown) => {
    expect(unbrokenName(name)).toBe(shown);
  });

  it('is what a touch seat prints', () => {
    const card = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'RosterCarCard.tsx'),
      'utf8',
    );
    expect(card).toContain('{unbrokenName(name)}');
  });
});
