// THE DAILY «تعيين السيارات» UNCHANGED — the optional props «الطقم الثابت» added to the daily pieces.
//
// The standing-crew screen reuses the daily board's real pieces, and a few of them say something
// about a DAY that a standing crew does not have («متاح», «لا يوجد سائقون متاحون في هذا التاريخ»,
// «السائقون المتاحون», the workshop lock). Each such piece gained an OPTIONAL prop. This file pins
// both halves: rendered WITHOUT the prop, the piece gives exactly today's daily facts (the daily's
// own specs read the same markup); WITH it, the standing crew's.
//
// The touch sheets open in a portal, which a server render cannot draw — the sheet's frame is
// replaced here by a plain box that shows its title and subtitle, so what each sheet hands its
// frame can be read.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { type FleetRosterRowDto, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import { authSlice } from '../../../../store/authSlice';
import { translate } from '../../../../platform/localization/i18n';
import { type DriverOption, type DriverOptions } from '../../lib/roster-board';
import { DriverSlotPicker } from '../DriverSlotPicker';
import { ExcelPill } from './roster-desk-parts';
import { SeatCell, type SeatFacts as DeskSeatFacts } from './roster-desk-cells';
import { AvailableList, DriversHeading } from './roster-drivers';
import { DriversButton, ExcelButton, MissionSheet, NotesSheet } from './roster-touch-parts';
import { CarCard, type CardHandlers, type SeatFacts as CardSeatFacts } from './RosterCarCard';

vi.mock('./RosterBottomSheet', () => ({
  BottomSheet: ({
    name,
    open,
    title,
    subtitle,
    children,
    footer,
  }: {
    name: string;
    open: boolean;
    title: string;
    subtitle?: string;
    children: ReactNode;
    footer?: ReactNode;
  }): JSX.Element | null =>
    open ? (
      <section data-sheet={name} data-title={title} data-subtitle={subtitle ?? ''}>
        {children}
        {footer}
      </section>
    ) : null,
}));

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (file: string): string => readFileSync(join(HERE, file), 'utf8');

const V1 = '650000000000000000000001';
const E1 = '650000000000000000000011';
const E3 = '650000000000000000000013';

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
const POOL_EMPTY = 'لا يوجد سائقون بلا طقم ثابت';

const row = (over: Partial<FleetRosterRowDto> = {}): FleetRosterRowDto => ({
  vehicleId: V1,
  code: '150',
  plateNumber: 'س ص 150',
  typeId: 'vt1',
  inMaintenance: false,
  planned: true,
  missionTypeId: null,
  driver1EmployeeId: null,
  driver2EmployeeId: null,
  notes: null,
  ...over,
});

const option = (employeeId: string, over: Partial<DriverOption> = {}): DriverOption => ({
  employeeId,
  state: 'free',
  seatedCode: null,
  onTarget: false,
  licenceExpired: false,
  ...over,
});
const none: DriverOptions = { free: [], flagged: [], seated: [], elsewhere: [] };

// ── the Excel controls ──────────────────────────────────────────────────────────────────────────

describe('ExcelPill and ExcelButton — the screen’s export hook', () => {
  it('say «roster» on the daily board, as before', () => {
    expect(render(<ExcelPill onExport={() => undefined} />)).toContain('data-export="roster"');
    expect(render(<ExcelButton onExport={() => undefined} />)).toContain('data-export="roster"');
  });
  it('say the standing crew’s own name when given', () => {
    const pill = render(<ExcelPill onExport={() => undefined} name="fixed-roster" />);
    expect(pill).toContain('data-export="fixed-roster"');
    expect(pill).not.toContain('data-export="roster"');
    expect(pill, 'the same words').toContain(t('fleet.fuelCards.board.excel'));
    const button = render(<ExcelButton onExport={() => undefined} name="fixed-roster" />);
    expect(button).toContain('data-export="fixed-roster"');
    expect(button).toContain(`title="${t('fleet.export.excel')}"`);
  });
});

// ── the drivers button ──────────────────────────────────────────────────────────────────────────

describe('DriversButton — its name', () => {
  it('is «السائقون المتاحون» on the daily board', () => {
    const html = render(<DriversButton count={3} onOpen={() => undefined} />);
    expect(html).toContain(`aria-label="${t('fleet.roster.availableTitle')}"`);
    expect(html).toContain(`title="${t('fleet.roster.availableTitle')}"`);
    expect(t('fleet.roster.availableTitle')).toBe('السائقون المتاحون');
  });
  it('is the label given — «السائقون» on the standing crew', () => {
    const html = render(
      <DriversButton
        count={3}
        onOpen={() => undefined}
        label={t('fleet.fixedRoster.driversTitle')}
        compact
      />,
    );
    expect(html).toContain(`aria-label="${t('fleet.fixedRoster.driversTitle')}"`);
    expect(html).toContain(`title="${t('fleet.fixedRoster.driversTitle')}"`);
    expect(html).not.toContain(t('fleet.roster.availableTitle'));
    expect(html, 'the count in Latin digits').toContain('>3</span>');
  });
});

// ── the seat picker ─────────────────────────────────────────────────────────────────────────────

describe('DriverSlotPicker and SeatCell — the "nobody to offer" line', () => {
  it('says the day’s sentence unless told otherwise, and the seat hands its own line on', () => {
    expect(source('../DriverSlotPicker.tsx')).toContain(
      "(emptyLabel ?? t('fleet.roster.availableEmpty'))",
    );
    const cells = source('roster-desk-cells.tsx');
    const picker = cells.slice(cells.indexOf('<DriverSlotPicker'));
    expect(picker.slice(0, picker.indexOf('/>'))).toContain('emptyLabel={emptyLabel}');
  });

  it('draws the same closed trigger either way', () => {
    const plain = render(
      <DriverSlotPicker
        drivers={[]}
        index={new Map()}
        onSelect={() => undefined}
        slotKey="k"
        label="150"
      />,
    );
    const told = render(
      <DriverSlotPicker
        drivers={[]}
        index={new Map()}
        onSelect={() => undefined}
        slotKey="k"
        label="150"
        emptyLabel={POOL_EMPTY}
      />,
    );
    expect(told).toBe(plain);
    expect(plain).toContain(t('fleet.roster.pickDriver'));
  });

  it('an empty seat is the daily seat, with or without the line', () => {
    const facts: DeskSeatFacts = {
      expired: new Set(),
      unavailable: new Map(),
      transferFrom: () => null,
      person: () => undefined,
      reasonLabel: (reason) => reason,
    };
    const seat = (emptyLabel?: string): string =>
      render(
        <SeatCell
          row={row()}
          slot="driver1EmployeeId"
          mayPlan
          over={null}
          setOver={() => undefined}
          dragging={null}
          setDragging={() => undefined}
          facts={facts}
          pool={[]}
          searchIndex={new Map()}
          onDrop={() => undefined}
          onClear={() => undefined}
          emptyLabel={emptyLabel}
        />,
      );
    expect(seat(POOL_EMPTY)).toBe(seat());
    expect(seat()).toContain(`data-driver-picker="${V1}:driver1EmployeeId"`);
  });
});

// ── the drivers list ────────────────────────────────────────────────────────────────────────────

describe('AvailableList — «متاح» and the empty lines', () => {
  const list = (props: Partial<Parameters<typeof AvailableList>[0]> = {}): string =>
    render(
      <AvailableList
        options={{ ...none, free: [option(E3)] }}
        person={() => undefined}
        onPick={null}
        licence={null}
        dayHasDrivers
        searched={false}
        {...props}
      />,
    );

  it('says «متاح» on a free row on the daily board', () => {
    expect(list()).toContain(t('fleet.roster.free'));
    expect(t('fleet.roster.free')).toBe('متاح');
  });

  it('leaves it off when told — every other badge stays', () => {
    const html = list({
      freeBadge: false,
      options: { ...none, free: [option(E3)], seated: [option(E1, { state: 'seated' })] },
    });
    expect(html).not.toContain(t('fleet.roster.free'));
    expect(html, 'the held-off row keeps its blue «سيارة أخرى»').toContain(
      t('fleet.roster.otherVehicle'),
    );
    expect(html).toContain(t('fleet.roster.onOtherVehicles'));
    expect(html).toContain(`data-driver-card="${E3}"`);
  });

  it('says the day’s empty line by default — both of them', () => {
    const free = list({ options: none });
    expect(free).toContain('data-available-empty="day"');
    expect(free).toContain(t('fleet.roster.availableEmpty'));
    expect(list({ dayHasDrivers: false })).toContain(t('fleet.roster.availableEmpty'));
  });

  it('says the line given instead — both of them', () => {
    const free = list({ options: none, emptyLabel: POOL_EMPTY });
    expect(free).toContain(POOL_EMPTY);
    expect(free).not.toContain(t('fleet.roster.availableEmpty'));
    const nobody = list({ dayHasDrivers: false, emptyLabel: POOL_EMPTY });
    expect(nobody).toContain(POOL_EMPTY);
    expect(nobody).not.toContain(t('fleet.roster.availableEmpty'));
  });

  it('keeps the search miss as it is', () => {
    for (const emptyLabel of [undefined, POOL_EMPTY]) {
      const html = list({ options: none, searched: true, emptyLabel });
      expect(html).toContain(t('fleet.fixedRoster.driverSearchEmpty'));
      expect(html).not.toContain(POOL_EMPTY);
    }
  });
});

describe('DriversHeading — one list’s heading in the tabs’ place', () => {
  it('says the label and the count in the selected tab’s face, with no tab role', () => {
    const html = render(<DriversHeading label={t('fleet.fixedRoster.driversTitle')} count={12} />);
    expect(html).toContain(t('fleet.fixedRoster.driversTitle'));
    expect(html).toContain('data-drivers-heading="true"');
    expect(html).toContain('>12</span>');
    expect(html).toContain('text-emerald-800');
    expect(html).not.toContain('role="tab');
  });
});

// ── the touch sheets ────────────────────────────────────────────────────────────────────────────

describe('MissionSheet — its title and its notice', () => {
  const sheet = (props: Partial<Parameters<typeof MissionSheet>[0]> = {}): string =>
    render(
      <MissionSheet
        row={row()}
        missions={[]}
        onPick={() => undefined}
        onClose={() => undefined}
        {...props}
      />,
    );
  it('is «تعيين السيارة 150» with no notice on the daily board', () => {
    const html = sheet();
    expect(html).toContain(`data-title="${t('fleet.roster.assignTitle', { code: '150' })}"`);
    expect(html).not.toContain('data-mission-notice');
  });
  it('takes the title and the notice given', () => {
    const html = sheet({
      title: `${t('common.edit')} · 150`,
      notice: t('fleet.fixedRoster.noMissionTypesYet'),
    });
    expect(html).toContain(`data-title="${t('common.edit')} · 150"`);
    expect(html).toContain('data-mission-notice="true"');
    expect(html).toContain(t('fleet.fixedRoster.noMissionTypesYet'));
  });
});

describe('NotesSheet — its title, its subtitle and its cap', () => {
  const sheet = (props: Partial<Parameters<typeof NotesSheet>[0]> = {}): string =>
    render(
      <NotesSheet row={row()} onSave={() => undefined} onClose={() => undefined} {...props} />,
    );
  it('is the daily «تعيين السيارة 150» · «تعديل التعيين», uncapped', () => {
    const html = sheet();
    expect(html).toContain(`data-title="${t('fleet.roster.assignTitle', { code: '150' })}"`);
    expect(html).toContain(`data-subtitle="${t('fleet.roster.editAssignment')}"`);
    expect(html).not.toContain('maxLength');
    expect(html).not.toContain('maxlength');
  });
  it('takes what it is given — «تعديل · 150» · «ملاحظات», 500 letters', () => {
    const html = sheet({
      title: `${t('common.edit')} · 150`,
      subtitle: t('fleet.attendance.fields.notes'),
      maxLength: 500,
    });
    expect(html).toContain(`data-title="${t('common.edit')} · 150"`);
    expect(html).toContain(`data-subtitle="${t('fleet.attendance.fields.notes')}"`);
    expect(html).toMatch(/maxlength="500"/iu);
  });
});

// ── the car card ────────────────────────────────────────────────────────────────────────────────

describe('CarCard — the workshop lock, the badges, the ⋮ words', () => {
  const facts: CardSeatFacts = {
    expired: new Set(),
    unavailable: new Map(),
    transferFrom: () => null,
    armed: false,
    person: () => undefined,
    reasonLabel: (reason) => reason,
  };
  const handlers: CardHandlers = {
    onSlot: () => undefined,
    onClear: () => undefined,
    onSwap: () => undefined,
    onMission: () => undefined,
    onClearAll: () => undefined,
    onEditNotes: () => undefined,
    onDropDriver: () => undefined,
  };
  const card = (
    data: FleetRosterRowDto,
    props: Partial<Parameters<typeof CarCard>[0]> = {},
  ): string =>
    render(
      <CarCard
        row={data}
        layout="portrait"
        mayPlan
        unsaved={false}
        facts={facts}
        missionName={() => '—'}
        target={null}
        handlers={handlers}
        {...props}
      />,
    );
  const workshop = row({ code: '151', inMaintenance: true });

  it('locks a car the workshop holds on the daily board', () => {
    const html = card(workshop);
    expect(html).toContain('data-workshop="true"');
    expect(html).toContain('data-workshop-lock="151"');
    expect(html).toContain(t('fleet.roster.inWorkshopNoDrop'));
    expect(html, 'no seat to fill').not.toContain('data-slot-state="empty"');
  });

  it('draws it as any car when told — its seats take a driver, in its place', () => {
    const html = card(workshop, { workshopLock: false });
    expect(html).not.toContain('data-workshop=');
    expect(html).not.toContain('data-workshop-lock');
    expect(html).not.toContain(t('fleet.roster.inWorkshopNoDrop'));
    expect(html).toContain('data-slot="151:1" data-slot-state="empty"');
    expect(html, 'the mission is a button').toContain('data-mission="151"');
    expect(html, 'the badge still reads the real row').toContain(t('fleet.vehicles.inWorkshop'));
  });

  it('wears the row’s badges by default, and the ones given instead', () => {
    const crewed = row({ driver1EmployeeId: E1 });
    expect(card(crewed)).toContain(t('fleet.roster.assigned'));
    const own = card(crewed, { badges: <span data-own-badges="true">مخصص</span> });
    expect(own).toContain('data-own-badges="true"');
    expect(own).not.toContain(t('fleet.roster.assigned'));
    const phone = card(crewed, { layout: 'phone', badges: <span data-own-badges="true" /> });
    expect(phone, 'in the phone’s place too').toContain('data-own-badges="true"');
    expect(phone).not.toContain(t('fleet.roster.assigned'));
  });

  it('names the note’s edit «تعديل التعيين» by default, and the word given instead', () => {
    const noted = row({ notes: 'ملاحظة' });
    expect(card(noted)).toContain(`aria-label="150 · ${t('fleet.roster.editAssignment')}"`);
    const own = card(noted, {
      menu: {
        edit: t('common.edit'),
        clear: t('fleet.fixedRoster.clearCrew'),
        canClear: () => true,
      },
    });
    expect(own).toContain(`aria-label="150 · ${t('common.edit')}"`);
    expect(own).not.toContain(t('fleet.roster.editAssignment'));
  });

  it('the ⋮ items say the words they are handed, and «clear» shows by the rule handed', () => {
    const file = source('RosterCarCard.tsx');
    expect(file).toContain("const editWord = words?.edit ?? t('fleet.roster.editAssignment');");
    expect(file).toContain("const clearWord = words?.clear ?? t('fleet.roster.clearAssignment');");
    expect(file).toContain('const mayClear = words?.canClear ?? carriesPlan;');
    expect(file).toContain('const menuClear = mayPlan && mayClear(row) ?');
    const menu = file.slice(file.indexOf('const MoreMenu ='), file.indexOf('const Avatar ='));
    expect(menu).toContain('{editLabel}');
    expect(menu).toContain('{clearLabel}');
    expect(menu, 'no day word of its own left in it').not.toMatch(
      /fleet\.roster\.(editAssignment|clearAssignment)/u,
    );
  });

  it('the lock is the daily rule unless turned off', () => {
    expect(source('RosterCarCard.tsx')).toContain(
      'const locked = workshopLock && row.inMaintenance;',
    );
    expect(source('RosterCarCard.tsx')).toContain('workshopLock = true,');
  });
});
