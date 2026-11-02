// «عقود توريد السيارات», proven against what the screens produce: the list's rows with the supply
// alarm (its solid pill, the row held in its colour, `?alarm=` asked of the server), the unnamed
// contract's fallback name, the faded «تسجيل استلام» once every car arrived, the grants on every
// button; the contract page's strip in red and yellow; «تسجيل استلام» refusing more than is owed;
// and the editor, new and on a saved contract — with «المستلم حتى الآن» (batch 3): typed on a new
// contract by a holder of «تسجيل استلام», not drawn without it, locked on an edit.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type FleetSupplyAlarmDto,
  type FleetVehicleContractDto,
  type FleetVehicleTypeDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { detailKey, listKey } from '../../../shared/lib/query-keys';
import { VehicleContractsPage } from './VehicleContractsPage';
import { VehicleContractPage } from './VehicleContractPage';
import { VehicleContractEditorPage } from './VehicleContractEditorPage';
import { VehicleContractDeliveryDialog } from '../components/VehicleContractDeliveryDialog';
import {
  ReceivedTotals,
  VehicleContractLinesEditor,
  lineInvalid,
} from '../components/VehicleContractLinesEditor';
import { type EditorLine, type ReceivedMode } from '../lib/vehicle-contract-figures';

// `DesignDialog` and the viewer portal into `document.body`; the suite runs without a DOM.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});

const me = (permissions: string[]): MeDto =>
  ({
    id: 'u-1',
    email: 'user@ecms.local',
    username: null,
    mustChangePassword: false,
    name: { firstName: { ar: 'أ', en: 'A' }, lastName: { ar: 'ب', en: 'B' } },
    locale: 'ar',
    theme: 'system',
    navLayout: 'rail',
    branchId: null,
    branchIds: [],
    employeeId: null,
    permissions: Object.fromEntries(permissions.map((key) => [key, 'organization' as const])),
    isPrivileged: false,
    flags: {},
    totpEnabled: true,
    external: null,
  }) as unknown as MeDto;

const store = (permissions: string[]) =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });

const ALL = [
  'fleetVehicleContract.view',
  'fleetVehicleContract.create',
  'fleetVehicleContract.edit',
  'fleetVehicleContract.delete',
  'fleetVehicleContract.receive',
];
const VIEW_ONLY = ['fleetVehicleContract.view'];

const ID = (n: number): string => `65f0000000000000000000${String(n).padStart(2, '0')}`;
const SPRINTER = { ar: 'مرسيدس اسبرانتر 516', en: 'Mercedes Sprinter 516' };
const ACCELO = { ar: 'مرسيدس اسيليو 916', en: 'Mercedes Accelo 916' };

const alarm = (level: 'red' | 'yellow', days: number, left: number): FleetSupplyAlarmDto => ({
  level,
  days,
  left,
  lines: [{ lineId: ID(11), left }],
});

/** His contract: 22 Sprinter + 11 Accelo, 32 received — one Sprinter still owed. */
const contract = (over: Partial<FleetVehicleContractDto> = {}): FleetVehicleContractDto => ({
  id: ID(1),
  no: 2,
  name: 'عقد توريد عربات نقل أموال',
  date: '2025-12-08',
  deadline: '2026-10-24',
  supplier: 'الهيئة العربية للتصنيع',
  lines: [
    {
      id: ID(11),
      typeId: ID(21),
      typeName: SPRINTER,
      count: 22,
      unitPrice: 4_700_000,
      total: 103_400_000,
      received: 21,
      remaining: 1,
    },
    {
      id: ID(12),
      typeId: ID(22),
      typeName: ACCELO,
      count: 11,
      unitPrice: 5_400_000,
      total: 59_400_000,
      received: 11,
      remaining: 0,
    },
  ],
  deliveries: [
    {
      id: ID(31),
      no: 1,
      date: '2026-02-10',
      counts: [{ lineId: ID(11), count: 8 }],
      total: 8,
      receivedAfter: 8,
      remainingAfter: 25,
      createdAt: '2026-02-10T09:00:00.000Z',
      updatedAt: '2026-02-10T09:00:00.000Z',
    },
    {
      id: ID(32),
      no: 2,
      date: '2026-04-15',
      counts: [
        { lineId: ID(11), count: 13 },
        { lineId: ID(12), count: 11 },
      ],
      total: 24,
      receivedAfter: 32,
      remainingAfter: 1,
      createdAt: '2026-04-15T09:00:00.000Z',
      updatedAt: '2026-04-15T09:00:00.000Z',
    },
  ],
  files: [
    {
      fileId: ID(41),
      fileName: 'صفحة 1.png',
      mime: 'image/png',
      size: 88_784,
      kind: 'image',
      addedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      fileId: ID(42),
      fileName: 'العقد كاملًا.pdf',
      mime: 'application/pdf',
      size: 4_068_245,
      kind: 'pdf',
      addedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  contracted: 33,
  received: 32,
  remaining: 1,
  total: 162_800_000,
  alarm: alarm('red', 5, 1),
  version: 3,
  // Saved by someone else than the reader `me` (u-1).
  createdBy: ID(51),
  createdAt: '2025-12-08T00:00:00.000Z',
  updatedAt: '2026-04-15T09:00:00.000Z',
  ...over,
});

const TYPES: FleetVehicleTypeDto[] = [
  { id: ID(21), name: SPRINTER, isActive: true },
  { id: ID(22), name: ACCELO, isActive: false },
  { id: ID(23), name: { ar: 'تويوتا هاى اس', en: 'Toyota Hiace' }, isActive: true },
].map(
  (type) =>
    ({ ...type, maintenanceIntervalKm: 0, sortOrder: null, version: 0 }) as FleetVehicleTypeDto,
);

const LIST = { page: 1, pageSize: 25, sortBy: 'date', sortDir: 'desc', sort: 'date:desc' };

const render = (
  at: string,
  seed: (qc: QueryClient) => void,
  permissions: string[] = ALL,
): string => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(listKey('fleet', 'vehicleTypes', { pageSize: 100 }), {
    items: TYPES,
    meta: { page: 1, pageSize: 100, totalItems: TYPES.length, totalPages: 1 },
  });
  seed(qc);
  return renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[at]}>
          <Routes>
            <Route path="/fleet/vehicle-contracts" element={<VehicleContractsPage />} />
            <Route path="/fleet/vehicle-contracts/new" element={<VehicleContractEditorPage />} />
            <Route path="/fleet/vehicle-contracts/:id" element={<VehicleContractPage />} />
            <Route
              path="/fleet/vehicle-contracts/:id/edit"
              element={<VehicleContractEditorPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
};

const renderList = (
  rows: FleetVehicleContractDto[],
  params: Record<string, unknown> = LIST,
  at = '/fleet/vehicle-contracts',
  permissions = ALL,
): string =>
  render(
    at,
    (qc) =>
      qc.setQueryData(listKey('fleet', 'vehicleContracts', params), {
        items: rows,
        meta: { page: 1, pageSize: 25, totalItems: rows.length, totalPages: 1 },
      }),
    permissions,
  );

const renderContract = (c: FleetVehicleContractDto, permissions = ALL, edit = false): string =>
  render(
    `/fleet/vehicle-contracts/${c.id}${edit ? '/edit' : ''}`,
    (qc) => qc.setQueryData(detailKey('fleet', 'vehicleContracts', c.id), c),
    permissions,
  );

const count = (html: string, needle: string): number => html.split(needle).length - 1;
/** The dialog's Save, as drawn — its attributes in whatever order React writes them. */
const saveButton = (html: string): string =>
  /<button[^>]*data-contract-delivery-save="true"[^>]*>/u.exec(html)?.[0] ?? '';

describe('the list', () => {
  it('draws each contract with its makes, received share, alarm and total', () => {
    const html = renderList([contract()]);
    expect(html).toContain('عقد واحد');
    expect(html).toContain('عقد توريد عربات نقل أموال');
    expect(html).toContain('مرسيدس اسبرانتر 516');
    expect(html).toContain('×22');
    expect(html).toContain('data-contract-received="' + ID(1) + '"');
    expect(html).toContain('97%');
    expect(html).toContain('المتبقي 1');
    expect(html).toContain('162,800,000.00');
    // The alarm: the solid pill, «بعد 5 أيام», and the whole row held in red.
    expect(html).toContain('data-supply-alarm="red"');
    expect(html).toContain('data-supply-days="5"');
    expect(html).toContain('بعد ');
    expect(html).toContain('data-alarm="red"');
    expect(html).toContain('title="المتبقي سيارة واحدة — آخر موعد للتوريد بعد 5 أيام"');
    // Two files, one of them a PDF.
    expect(html).toContain(`data-contract-files="${ID(1)}"`);
    expect(html).toContain('ملفان — صور: 1، ملفات PDF: 1');
  });

  it('a yellow alarm, and a contract with none', () => {
    const html = renderList([
      contract({ id: ID(2), alarm: alarm('yellow', 22, 3), remaining: 3, received: 30 }),
      contract({ id: ID(3), alarm: null }),
    ]);
    expect(html).toContain('data-alarm="yellow"');
    expect(html).toContain('data-supply-alarm="yellow"');
    expect(html).toContain('22');
    expect(html).toContain('data-alarm="none"');
  });

  it('`?alarm=red` is in the address and asked of the server', () => {
    const html = renderList(
      [contract()],
      { ...LIST, alarm: ['red'] },
      '/fleet/vehicle-contracts?alarm=red',
    );
    expect(html).toContain('عقد توريد عربات نقل أموال');
  });

  it('a contract with no name is called by its number, in grey', () => {
    const html = renderList([contract({ name: '', no: 3 })]);
    expect(html).toContain('data-contract-name="fallback"');
    expect(html).toContain('عقد رقم 3');
    expect(html).toContain('title="لم يُكتب اسم لهذا العقد"');
  });

  it('«تسجيل استلام» stays in its place, faded and saying why, once every car arrived', () => {
    const done = contract({ remaining: 0, received: 33, alarm: null });
    const html = renderList([done]);
    expect(html).toContain('data-locked-action="contract-receive"');
    expect(html).toContain('title="تم استلام كل السيارات المتعاقد عليها"');
    expect(html).not.toContain(`data-contract-receive="${ID(1)}"`);
    expect(renderList([contract()])).toContain(`data-contract-receive="${ID(1)}"`);
  });

  it('each button needs its grant — a reader sees the eye only', () => {
    const full = renderList([contract()]);
    expect(full).toContain('data-contract-new="true"');
    expect(full).toContain(`data-contract-edit="${ID(1)}"`);
    expect(full).toContain(`data-contract-delete="${ID(1)}"`);
    const reader = renderList([contract()], LIST, '/fleet/vehicle-contracts', VIEW_ONLY);
    expect(reader).toContain(`data-contract-view="${ID(1)}"`);
    expect(reader).not.toContain('data-contract-new');
    expect(reader).not.toContain('data-contract-edit');
    expect(reader).not.toContain('data-contract-receive=');
    expect(reader).not.toContain('data-contract-delete');
    expect(reader).not.toContain('data-locked-action');
  });
});

describe("the contract's page", () => {
  it('opens on the red strip: one car left, five days to the last date', () => {
    const html = renderContract(contract());
    expect(html).toContain('data-contract-alarm="red"');
    expect(html).toContain('المتبقي سيارة واحدة');
    expect(html).toContain('آخر موعد للتوريد بعد ');
    expect(html).toContain(`data-contract-alarm-line="${ID(11)}"`);
    expect(html).toContain('عقد رقم 2 — بتاريخ 2025/12/08 — آخر موعد للتوريد 2026/10/24');
  });

  it('a yellow strip, overdue words, and no strip without an alarm', () => {
    expect(renderContract(contract({ alarm: alarm('yellow', 22, 1) }))).toContain(
      'data-contract-alarm="yellow"',
    );
    expect(renderContract(contract({ alarm: alarm('red', -9, 1) }))).toContain(
      ' أيام عن آخر موعد للتوريد',
    );
    expect(renderContract(contract({ alarm: null }))).not.toContain('data-contract-alarm=');
  });

  it('shows its figures, lines, deliveries and attachments', () => {
    const html = renderContract(contract());
    expect(html).toContain('تم استلام 32 من 33 سيارة');
    expect(html).toContain('غير شامل ضريبة القيمة المضافة');
    expect(html).toContain('14%');
    expect(html).toContain('الاستلام الأول');
    expect(html).toContain('الاستلام الثاني');
    expect(html).toContain(`data-contract-file="${ID(41)}"`);
    expect(html).toContain('ملف PDF');
    expect(html).toContain('87 ك.ب');
    expect(count(html, 'data-contract-delivery-edit=')).toBe(2);
  });

  it('a reader cannot edit, receive, add or change attachments', () => {
    const html = renderContract(contract(), VIEW_ONLY);
    expect(html).not.toContain('data-contract-edit-open');
    expect(html).not.toContain('data-contract-receive-open');
    expect(html).not.toContain('data-contract-delivery-edit');
    expect(html).not.toContain('data-contract-add-files');
    expect(html).not.toContain('data-contract-file-remove');
  });

  it('`create` without `edit` adds pages only to a contract the reader saved', () => {
    const CREATE = ['fleetVehicleContract.view', 'fleetVehicleContract.create'];
    const theirs = renderContract(contract({ files: [] }), CREATE);
    expect(theirs).not.toContain('data-contract-add-files');
    const mine = renderContract(contract({ files: [], createdBy: 'u-1' }), CREATE);
    expect(mine).toContain('data-contract-add-files');
    expect(mine).not.toContain('data-contract-file-remove');
    expect(renderContract(contract({ files: [] }))).toContain('data-contract-add-files');
  });

  it('a contract received in full offers no «تسجيل استلام»', () => {
    const html = renderContract(contract({ remaining: 0, received: 33, alarm: null }));
    expect(html).not.toContain('data-contract-receive-open');
  });
});

describe('«تسجيل استلام»', () => {
  const renderDialog = (c: FleetVehicleContractDto, editing: string | null): string => {
    const qc = new QueryClient();
    return renderToStaticMarkup(
      <Provider store={store(ALL)}>
        <QueryClientProvider client={qc}>
          <VehicleContractDeliveryDialog
            open
            onClose={() => undefined}
            contract={c}
            editing={c.deliveries.find((d) => d.id === editing) ?? null}
            onRefused={() => undefined}
          />
        </QueryClientProvider>
      </Provider>,
    );
  };

  it('a new delivery: the third, its ordinal locked, Save waiting for a figure', () => {
    const html = renderDialog(contract(), null);
    expect(html).toContain('data-contract-delivery="3"');
    expect(html).toContain('الاستلام الثالث');
    expect(html).toContain('الاستلامات السابقة');
    expect(saveButton(html)).toContain('disabled=""');
  });

  it('more than is still owed turns the row rose, says so, and Save waits', () => {
    // Two more Accelo were recorded elsewhere: without this delivery's own 11, the line of 11 has
    // only 9 left, so its 11 is over.
    const c = contract();
    const raced = {
      ...c,
      lines: c.lines.map((l) => (l.id === ID(12) ? { ...l, received: 13, remaining: -2 } : l)),
    };
    const html = renderDialog(raced, ID(32));
    expect(html).toContain('data-contract-delivery-over-line="true"');
    expect(html).toContain('data-contract-delivery-over="true"');
    expect(html).toContain('أكثر من المتبقي');
    expect(html).toContain('مرسيدس اسيليو 916');
    expect(saveButton(html)).toContain('disabled=""');
  });

  it("an edit opens on the delivery's own counts and is not over", () => {
    const html = renderDialog(contract(), ID(32));
    expect(html).toContain('تعديل الاستلام');
    expect(html).toContain('value="13"');
    expect(html).toContain('value="11"');
    expect(html).not.toContain('data-contract-delivery-over=');
    expect(saveButton(html)).not.toBe('');
    expect(saveButton(html)).not.toContain('disabled=""');
  });
});

describe('the editor', () => {
  it('a new contract opens with its date, one empty line and the drop box', () => {
    const html = render('/fleet/vehicle-contracts/new', () => undefined);
    expect(html).toContain('data-contract-editor="new"');
    expect(html).toContain('عقد جديد');
    expect(count(html, 'data-contract-line="')).toBe(1);
    expect(html).toContain('اختر الماركة');
    expect(html).toContain('data-contract-drop="true"');
    expect(html).toContain('data-contract-save="true"');
    // Only the active makes are offered.
    expect(html).toContain('تويوتا هاى اس');
    expect(html).not.toContain('مرسيدس اسيليو 916');
  });

  it("an edit opens on the contract's lines, its files in the tray, received lines locked", () => {
    const html = renderContract(contract(), ALL, true);
    expect(html).toContain('data-contract-editor="edit"');
    expect(html).toContain('تعديل العقد');
    expect(count(html, 'data-contract-line="')).toBe(2);
    expect(html).toContain('value="22"');
    // The line's own make stays offered though deactivated since.
    expect(html).toContain('مرسيدس اسيليو 916');
    expect(count(html, 'data-locked-action="contract-line-remove"')).toBe(2);
    expect(html).toContain(`data-contract-file="${ID(41)}"`);
    expect(html).toContain('data-contract-total="162800000"');
  });
});

describe('«المستلم حتى الآن» in the editor', () => {
  /** The section width the form takes beside the attachments. */
  const formWidth = (html: string): string => /lg:w-\[(\d+)%\]/u.exec(html)?.[1] ?? '';

  const renderLines = (lines: EditorLine[], mode: ReceivedMode = 'edit'): string => {
    const qc = new QueryClient();
    qc.setQueryData(listKey('fleet', 'vehicleTypes', { pageSize: 100 }), {
      items: TYPES,
      meta: { page: 1, pageSize: 100, totalItems: TYPES.length, totalPages: 1 },
    });
    return renderToStaticMarkup(
      <Provider store={store(ALL)}>
        <QueryClientProvider client={qc}>
          <VehicleContractLinesEditor
            lines={lines}
            receivedOf={() => 0}
            receivedMode={mode}
            receivedDate="2026-11-01"
            onReceivedDate={() => undefined}
            isMissing={() => false}
            showInvalid={false}
            onChange={() => undefined}
            onAdd={() => undefined}
            onRemove={() => undefined}
          />
        </QueryClientProvider>
      </Provider>,
    );
  };
  const typed = (key: string, typeId: string, count: string, received: string): EditorLine => ({
    key,
    id: null,
    typeId,
    count,
    price: '',
    received,
  });
  /** His new contract: 22 Sprinter with 15 received, 11 Accelo all received. */
  const HIS = [typed('k1', ID(21), '22', '15'), typed('k2', ID(22), '11', '11')];

  it('a new contract offers the column to a holder of «تسجيل استلام» — empty, nothing promised', () => {
    const html = render('/fleet/vehicle-contracts/new', () => undefined);
    expect(html).toContain('data-contract-received-head="edit"');
    expect(html).toContain('المستلم');
    expect(html).toContain('حتى الآن');
    expect(count(html, 'data-contract-received="')).toBe(1);
    expect(html).toContain('placeholder="0"');
    expect(html).toContain('data-contract-received-hint="edit"');
    expect(html).toContain('ويُسجَّل بوصفه «الاستلام الأول»');
    // Nothing written: no day to ask, nothing under the box, the footer as before.
    expect(html).not.toContain('data-contract-received-date');
    expect(html).not.toContain('data-contract-first-delivery');
    expect(html).not.toContain('data-contract-received-left');
    expect(html).not.toContain('data-contract-footer-received');
    expect(formWidth(html)).toBe('68');
  });

  it('without «تسجيل استلام» the column is not drawn and the form keeps its width', () => {
    const html = render('/fleet/vehicle-contracts/new', () => undefined, [
      'fleetVehicleContract.view',
      'fleetVehicleContract.create',
    ]);
    expect(html).toContain('data-contract-editor="new"');
    expect(html).not.toContain('data-contract-received-head');
    expect(html).not.toContain('data-contract-received="');
    expect(html).not.toContain('data-contract-received-hint');
    expect(formWidth(html)).toBe('62');
  });

  it('15 and 11 typed: what is left under each box, the day, and what Save records', () => {
    const html = renderLines(HIS);
    expect(html).toContain('value="15"');
    expect(html).toContain('data-contract-received-left="7"');
    expect(html).toContain('المتبقي 7');
    expect(html).toContain('data-contract-received-left="0"');
    expect(html).toContain('data-contract-first-delivery="26"');
    expect(html).toContain('data-contract-received-date="true"');
    expect(html).toContain('value="2026-11-01"');
    expect(html).toContain('تاريخ الاستلام');
    expect(html).toContain('يُسجَّل «الاستلام الأول» عند حفظ العقد:');
    expect(html).toContain('26');
    expect(html).toContain('من 33 سيارة');
    expect(html).toContain('ويتبقى 7 سيارات');
    expect(html).not.toContain('data-contract-received-over');
  });

  it('25 on the line of 22 turns rose, the note names the make, and nothing is promised', () => {
    const html = renderLines([typed('k1', ID(21), '22', '25'), HIS[1]!]);
    expect(html).toContain('data-contract-received-over="k1"');
    expect(html).toContain('أكثر من 22');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('bg-rose-50/70');
    expect(html).toContain('data-contract-received-over-note="true"');
    expect(html).toContain(
      'لا يمكن أن يزيد «المستلم حتى الآن» على المتعاقد عليه من البند: مرسيدس اسبرانتر 516 — 22 سيارة فقط.',
    );
    // The day is still asked; what Save records is not said while a box is over.
    expect(html).toContain('data-contract-received-date="true"');
    expect(html).not.toContain('يُسجَّل «الاستلام الأول»');
    // Save waits: the line is invalid, and the footer shows «المستلم» in rose without a «left».
    expect(lineInvalid(typed('k1', ID(21), '22', '25'), 0, 'edit')).toBe('receivedOver');
    expect(lineInvalid(typed('k1', ID(21), '22', '22'), 0, 'edit')).toBeNull();
    expect(lineInvalid(typed('k1', ID(21), '22', '25'), 0, 'locked')).toBeNull();
  });

  it('the footer: «— المستلم 26 · المتبقي 7», and only «المستلم» in rose while over', () => {
    const qc = new QueryClient();
    const footer = (received: number, left: number, over: boolean): string =>
      renderToStaticMarkup(
        <Provider store={store(ALL)}>
          <QueryClientProvider client={qc}>
            <ReceivedTotals received={received} left={left} over={over} />
          </QueryClientProvider>
        </Provider>,
      );
    const fine = footer(26, 7, false);
    expect(fine).toContain('data-contract-footer-received="26"');
    expect(fine).toContain('المستلم 26');
    expect(fine).toContain('المتبقي 7');
    const over = footer(36, 0, true);
    expect(over).toContain('المستلم 36');
    expect(over).toContain('text-rose-600');
    expect(over).not.toContain('المتبقي');
  });

  it('an edit shows the saved figure locked, with its reason, and the footer’s received', () => {
    const html = renderContract(contract(), ALL, true);
    expect(html).toContain('data-contract-received-head="locked"');
    expect(html).toContain(`data-contract-received-locked="${ID(11)}"`);
    expect(html).toContain(`data-contract-received-locked="${ID(12)}"`);
    expect(html).toContain('title="يُعدَّل المستلم من «الاستلامات» في صفحة العقد."');
    // No box to type in, and no day: received cars change through «الاستلامات».
    expect(html).not.toContain('data-contract-received="');
    expect(html).not.toContain('data-contract-received-date');
    expect(html).toContain('data-contract-received-left="1"');
    expect(html).toContain('data-contract-received-hint="locked"');
    expect(html).toContain('المستلم لا يُعدَّل هنا');
    expect(html).toContain('data-contract-footer-received="32"');
    expect(html).toContain('المستلم 32');
    expect(html).toContain('المتبقي 1');
    expect(formWidth(html)).toBe('68');
  });
});
