// The day board's hover cards — «لما اقف على العربيه تجيب مين اللى متعين عليها من سواقيين
// واخصائيين و لما اقف على القائد يجيب بياناته زى ما عاملين فى الحركه».
//
// What a typecheck cannot see:
//   • the van code is a trigger only when its crew row came with the board (a reader without
//     `operationsCrew.view` gets none — the code stays plain text);
//   • the van card names every place on the van — drivers, captain, both specialists — the drivers
//     by name only (their details are Fleet's), and a person the directory cannot name is never a
//     raw id;
//   • the captain card says the Fleet driver card's facts — code, phone, the van, the branch named
//     from the shared list — and has no phone line for a reader the server sends no phone to.
//
// The suite runs in node with no DOM, so nothing hovers: the triggers are read from static markup,
// and the bodies are rendered on their own over a seeded branch list.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type MeDto,
  type OperationsDayBoardCrewDto,
  type OperationsDayBoardVehicleCrewDto,
  type OrgUnitOptionDto,
} from '@ecms/contracts';
import type { ReactNode } from 'react';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { translate } from '../../../platform/localization/i18n';
import {
  CaptainCardBody,
  CaptainHoverName,
  CrewVehicleHoverCode,
  VehicleCrewCardBody,
} from './BoardCrewCards';

const BRANCH = '64b1f0bbbbbbbbbbbbbbbb01';
const CREW_ROW = '64b1f0cccccccccccccccc01';
const CAPTAIN = '64b1f0dddddddddddddddd01';

const CREW: OperationsDayBoardCrewDto = {
  crewAssignmentId: CREW_ROW,
  vehicleId: '64b1f0eeeeeeeeeeeeeeee01',
  vehicleCode: '120',
  captainEmployeeId: CAPTAIN,
  captainName: 'محمد عبد الله السيد',
  captainCode: '1042',
  captainPhone: '01001234567',
  captainBranchId: BRANCH,
};

const VEHICLE_CREW: OperationsDayBoardVehicleCrewDto = {
  crewAssignmentId: CREW_ROW,
  vehicleId: CREW.vehicleId,
  vehicleCode: '120',
  drivers: [
    { employeeId: '64b1f0ffffffffffffffff01', fullNameAr: 'سامر عادل منصور' },
    { employeeId: '64b1f0ffffffffffffffff02', fullNameAr: 'محمود سعيد عبد الحميد' },
  ],
  captains: [{ employeeId: CAPTAIN, code: '1042', fullNameAr: 'محمد عبد الله السيد' }],
  specialist1: [{ employeeId: '64b1f0ffffffffffffffff03', code: '3001', fullNameAr: 'أحمد فؤاد' }],
  // A person the directory no longer names: his code, never his id.
  specialist2: [{ employeeId: '64b1f0ffffffffffffffff04', code: '3002', fullNameAr: null }],
  direction: 'المعادي',
  plannedTime: '09:30',
};

const client = (seedBranches = true): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seedBranches) {
    qc.setQueryData(['organization', 'branches', 'options', 'withInactive'], [
      {
        id: BRANCH,
        code: 'CAI',
        name: { ar: 'القاهرة', en: 'Cairo' },
        parentId: null,
        catalogId: null,
      },
    ] satisfies OrgUnitOptionDto[]);
  }
  return qc;
};

const render = (
  node: ReactNode,
  { permissions = ['operationsShipment.view', 'operationsCrew.view'], qc = client() } = {},
): string =>
  renderToStaticMarkup(
    <Provider
      store={configureStore({
        reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
        preloadedState: {
          locale: { locale: 'ar' as const, dir: 'rtl' as const },
          auth: {
            me: {
              id: 'u1',
              permissions: Object.fromEntries(permissions.map((k) => [k, 'organization'])),
            } as unknown as MeDto,
            status: 'signedIn' as const,
          },
        },
      })}
    >
      <QueryClientProvider client={qc}>{node}</QueryClientProvider>
    </Provider>,
  );

const t = (key: string): string => translate('ar', key);

describe('the van code — a trigger only with its crew row', () => {
  it('with the crew row: the code is the trigger, reachable with Tab, no raw id', () => {
    const markup = render(<CrewVehicleHoverCode code="120" vehicleCrew={VEHICLE_CREW} />);
    expect(markup).toContain('data-crew-hover="true"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).not.toContain(CREW_ROW);
  });

  it('without it (no `operationsCrew.view`, or the crew row is gone): the plain code', () => {
    expect(render(<CrewVehicleHoverCode code="120" vehicleCrew={undefined} />)).toBe(
      '<span>120</span>',
    );
  });
});

describe('the van card — who rides the van', () => {
  const card = render(<VehicleCrewCardBody crew={VEHICLE_CREW} />);

  it('names the drivers, the captain and both specialists, each under its place', () => {
    for (const key of [
      'operations.board.card.drivers',
      'operations.crew.slot.captain',
      'operations.crew.slot.specialist1',
      'operations.crew.slot.specialist2',
    ]) {
      expect(card).toContain(t(key));
    }
    expect(card).toContain('سامر عادل منصور');
    expect(card).toContain('محمود سعيد عبد الحميد');
    expect(card).toContain('data-crew-card-slot="drivers" data-crew-card-count="2"');
    expect(card).toContain('محمد عبد الله السيد');
    expect(card).toContain('أحمد فؤاد');
    // Drivers, then the captain, then the specialists — the order the crew board reads in.
    expect(card.indexOf('سامر عادل منصور')).toBeLessThan(card.indexOf('محمد عبد الله السيد'));
    expect(card.indexOf('محمد عبد الله السيد')).toBeLessThan(card.indexOf('أحمد فؤاد'));
  });

  it('a driver is his name only — his details are Fleet’s, even if a code came along', () => {
    // «هعرف مين السواقين اللي عليها، لكن مش عايز اعرف بياناتهم». The server sends a driver's name
    // only; were a code ever to ride along, the card still would not print it.
    const leaky = render(
      <VehicleCrewCardBody
        crew={{
          ...VEHICLE_CREW,
          drivers: [
            {
              employeeId: '64b1f0ffffffffffffffff01',
              fullNameAr: 'سامر عادل منصور',
              code: 'DRV-2001',
              phone: '01009998877',
            } as OperationsDayBoardVehicleCrewDto['drivers'][number],
          ],
        }}
      />,
    );
    expect(leaky).toContain('سامر عادل منصور');
    expect(leaky).not.toContain('DRV-2001');
    expect(leaky).not.toContain('01009998877');
    // The captain and the specialists are Operations' own people: their codes stay.
    expect(card).toContain('1042');
    expect(card).toContain('3001');
  });

  it('an unnamed driver is a dash; an unnamed crew member is his code — never an id', () => {
    const unnamed = render(
      <VehicleCrewCardBody
        crew={{
          ...VEHICLE_CREW,
          drivers: [{ employeeId: '64b1f0ffffffffffffffff05', fullNameAr: null }],
        }}
      />,
    );
    expect(unnamed).toContain('data-crew-card-slot="drivers" data-crew-card-count="1"');
    expect(unnamed).toContain('—');
    expect(unnamed).not.toContain('64b1f0ffffffffffffffff05');
  });

  it('an unnamed person is his code — never his id', () => {
    expect(card).toContain('3002');
    expect(card).not.toContain('64b1f0ffffffffffffffff04');
  });

  it('the direction and planned time when the crew row has them, and not otherwise', () => {
    expect(card).toContain(t('operations.crew.direction'));
    expect(card).toContain('المعادي');
    expect(card).toContain('09:30');
    const bare = render(
      <VehicleCrewCardBody crew={{ ...VEHICLE_CREW, direction: null, plannedTime: null }} />,
    );
    expect(bare).not.toContain(t('operations.crew.direction'));
    expect(bare).not.toContain(t('operations.crew.plannedTime'));
  });

  it('an empty place is a dash, not left out', () => {
    const empty = render(
      <VehicleCrewCardBody crew={{ ...VEHICLE_CREW, drivers: [], specialist2: [] }} />,
    );
    expect(empty).toContain(t('operations.board.card.drivers'));
    expect(empty).not.toContain('data-crew-card-slot="drivers"');
    expect(empty).toContain('—');
  });
});

describe('the captain — his name opens the Fleet driver card’s facts', () => {
  it('the name is the trigger', () => {
    const markup = render(<CaptainHoverName crew={CREW} />);
    expect(markup).toContain('data-captain-hover="true"');
    expect(markup).toContain('محمد عبد الله السيد');
    expect(markup).not.toContain(CAPTAIN);
  });

  it('says the code, the phone, the van and the branch — the branch by its name', () => {
    const card = render(<CaptainCardBody crew={CREW} mayReadCrew />);
    expect(card).toContain(t('fleet.drivers.columns.employeeCode'));
    expect(card).toContain('1042');
    expect(card).toContain(t('fleet.drivers.columns.phone'));
    expect(card).toContain('01001234567');
    expect(card).toContain(t('operations.board.vehicle'));
    expect(card).toContain('120');
    expect(card).toContain(t('fleet.drivers.columns.branch'));
    expect(card).toContain('القاهرة');
    expect(card).not.toContain(BRANCH);
  });

  it('no phone line for a reader the server sends no phone to', () => {
    const card = render(
      <CaptainCardBody crew={{ ...CREW, captainPhone: null }} mayReadCrew={false} />,
    );
    expect(card).not.toContain(t('fleet.drivers.columns.phone'));
    expect(card).toContain('1042');
  });

  it('a branch still on its way reads «…», a captain with none reads «—»', () => {
    expect(render(<CaptainCardBody crew={CREW} mayReadCrew />, { qc: client(false) })).toContain(
      '…',
    );
    const none = render(<CaptainCardBody crew={{ ...CREW, captainBranchId: null }} mayReadCrew />);
    expect(none).toContain('—');
  });
});
