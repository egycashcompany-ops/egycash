// «عاوز عمود كمان لصورة الايصال زى شاشة السيارات اقدر ارفع صوره» — the receipt-image cell and its
// preview, rendered for real against the real Arabic catalog and a real store and query client.
//
// What is pinned is what an operator sees: an editor gets the dashed upload box on an empty row
// and the eye / replace / bin on a row with a photo; a reader gets «—» on an empty row and only the
// eye on a photo. Every control is named (`aria-label`), because each is an icon with no text —
// an unnamed icon is a button a screen reader announces as "button".
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type Locale, type MeDto, type OperationsShipmentDto } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { uiSlice } from '../../../store/uiSlice';
import { translate } from '../../../platform/localization/i18n';
import { del, fetchBlob, upload } from '../../../shared/lib/api-client';
import {
  deleteShipmentReceiptImage,
  fetchShipmentReceiptImage,
  uploadShipmentReceiptImage,
} from '../api/operations-api';
import {
  SHIPMENT_RECEIPT_IMAGE_ACCEPT,
  ShipmentReceiptImageCell,
  ShipmentReceiptImagePreviewDialog,
} from './ShipmentReceiptImageCell';

// The preview is a `Dialog`, portalled to the body; on the server the portal is the node itself.
(globalThis as Record<string, unknown>).document ??= { body: {} };
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-dom');
  return { ...actual, createPortal: (node: unknown) => node };
});
// Only the three transport calls the photo uses are stubbed, so the last block can read what the
// client puts on the wire. Rendering never reaches them: the static render runs no effect and no
// click, so the cell and preview blocks above are unaffected.
vi.mock('../../../shared/lib/api-client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../shared/lib/api-client');
  return {
    ...actual,
    upload: vi.fn(async () => ({})),
    fetchBlob: vi.fn(async () => new Blob()),
    del: vi.fn(async () => ({})),
  };
});

const ar = (key: string): string => translate('ar', key);

const EDIT = 'operationsShipment.edit';
const VIEW = 'operationsShipment.view';

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

const shipment = (over: Partial<OperationsShipmentDto> = {}): OperationsShipmentDto => ({
  id: 's-1',
  shipmentType: 'daily',
  status: 'draft',
  mainBankId: 'b-1',
  secondaryBankId: null,
  originBranchId: 'br-1',
  destinationBranchId: 'br-2',
  areaName: null,
  lines: [{ currencyId: 'c-egp', amount: 12000000 }],
  collectionDate: '2026-11-10T00:00:00.000Z',
  deliveryDate: null,
  receiptNumber: null,
  vaultReceiptNumber: null,
  receiptImage: null,
  serialTracked: false,
  notes: null,
  receivedById: null,
  receivedAt: null,
  version: 0,
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
  ...over,
});

const WITH_PHOTO = shipment({
  receiptImage: {
    fileId: 'f-1',
    fileName: 'receipt.jpg',
    mime: 'image/jpeg',
    size: 120_000,
    uploadedAt: '2026-11-10T09:00:00.000Z',
  },
});

const render = (permissions: string[], node: JSX.Element): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer, ui: uiSlice.reducer },
    preloadedState: {
      locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
      auth: { me: me(permissions), status: 'signedIn' as const },
      ui: { theme: 'light' as const, sidebarOpen: false },
    },
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={qc}>{node}</QueryClientProvider>
    </Provider>,
  );
};

const cell = (permissions: string[], row: OperationsShipmentDto): string =>
  render(permissions, <ShipmentReceiptImageCell row={row} onPreview={() => undefined} />);

/** The opening tag of the element carrying `attr` — its classes and name, nothing around it. */
const tagWith = (markup: string, attr: string): string =>
  markup.match(new RegExp(`<[a-z]+[^>]*${attr}[^>]*>`))?.[0] ?? '';

describe('the receipt-image cell on a row with no photo', () => {
  it('offers an editor the dashed upload box, named, taking photos only', () => {
    const html = cell([VIEW, EDIT], shipment());
    const box = tagWith(html, 'data-shipment-receipt-upload="s-1"');
    expect(box, 'the upload box').not.toBe('');
    // The Fleet image cells' empty box — dashed, the cloud inside.
    expect(box).toContain('border-dashed');
    expect(box).toContain(`aria-label="${ar('operations.shipment.receiptImage.upload')}"`);
    expect(ar('operations.shipment.receiptImage.upload')).not.toBe(
      'operations.shipment.receiptImage.upload',
    );
    expect(html).toContain(`accept="${SHIPMENT_RECEIPT_IMAGE_ACCEPT}"`);
    expect(SHIPMENT_RECEIPT_IMAGE_ACCEPT).toBe('image/jpeg,image/png,image/webp');
    // Nothing to view or delete yet.
    expect(html).not.toContain('data-shipment-receipt-view');
    expect(html).not.toContain('data-shipment-receipt-delete');
  });

  it('shows a reader a dash — no upload box for someone who may not edit the shipment', () => {
    const html = cell([VIEW], shipment());
    expect(html).toBe('<span class="text-slate-400">—</span>');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('type="file"');
  });

  it('treats a row that does not carry the field yet as having no photo', () => {
    const legacy = { ...shipment() } as Partial<OperationsShipmentDto>;
    delete legacy.receiptImage;
    expect(cell([VIEW], legacy as OperationsShipmentDto)).toBe(
      '<span class="text-slate-400">—</span>',
    );
  });
});

describe('the receipt-image cell on a row with a photo', () => {
  it('gives an editor view, replace and delete — each named', () => {
    const html = cell([VIEW, EDIT], WITH_PHOTO);
    expect(html).toContain('data-image-actions="shipment-receipt"');
    const view = tagWith(html, 'data-shipment-receipt-view="s-1"');
    const replace = tagWith(html, 'data-shipment-receipt-replace="s-1"');
    const remove = tagWith(html, 'data-shipment-receipt-delete="s-1"');
    expect(view).toContain(`aria-label="${ar('operations.shipment.receiptImage.view')}"`);
    expect(replace).toContain(`aria-label="${ar('operations.shipment.receiptImage.replace')}"`);
    expect(remove).toContain(`aria-label="${ar('operations.shipment.receiptImage.delete')}"`);
    // In the order the Fleet image box has them: eye, replace arrow, bin.
    expect(html.indexOf(view)).toBeLessThan(html.indexOf(replace));
    expect(html.indexOf(replace)).toBeLessThan(html.indexOf(remove));
    // A photo already there is replaced, never shown the empty box again.
    expect(html).not.toContain('data-shipment-receipt-upload');
    expect(html).not.toContain('border-dashed');
  });

  it('gives a reader the eye alone', () => {
    const html = cell([VIEW], WITH_PHOTO);
    expect(tagWith(html, 'data-shipment-receipt-view="s-1"')).toContain(
      `aria-label="${ar('operations.shipment.receiptImage.view')}"`,
    );
    expect(html).not.toContain('data-shipment-receipt-replace');
    expect(html).not.toContain('data-shipment-receipt-delete');
    expect(html).not.toContain('type="file"');
  });

  // The vault's receive queue is read on `operationsVault.view`; the photo's bytes on the shipment
  // grant. A treasurer without it is shown a dash — never an eye whose request would answer 403.
  it('gives a reader without the shipment grant a dash, not an eye that would be refused', () => {
    const html = cell(['operationsVault.view'], WITH_PHOTO);
    expect(html).toBe('<span class="text-slate-400">—</span>');
  });

  // «NO edit/delete» on the vault's receive queue: the photo is looked at there, never managed —
  // whatever the reader holds.
  it('offers an editor the eye alone on a screen that only looks', () => {
    const html = render(
      [VIEW, EDIT],
      <ShipmentReceiptImageCell row={WITH_PHOTO} onPreview={() => undefined} readOnly />,
    );
    expect(html).toContain('data-shipment-receipt-view="s-1"');
    expect(html).not.toContain('data-shipment-receipt-replace');
    expect(html).not.toContain('data-shipment-receipt-delete');
    expect(html).not.toContain('type="file"');
    const empty = render(
      [VIEW, EDIT],
      <ShipmentReceiptImageCell row={shipment()} onPreview={() => undefined} readOnly />,
    );
    expect(empty).toBe('<span class="text-slate-400">—</span>');
  });
});

describe('the receipt-image preview', () => {
  const preview = (permissions: string[]): string =>
    render(
      permissions,
      <ShipmentReceiptImagePreviewDialog open onClose={() => undefined} row={WITH_PHOTO} />,
    );

  it('is titled as the shipment receipt, with the operating day under the title', () => {
    const html = preview([VIEW]);
    expect(html).toContain(`aria-label="${ar('operations.shipment.receiptImage.title')}"`);
    expect(html).toContain('2026-11-10');
    expect(html).toContain(ar('common.close'));
  });

  it('offers delete to an editor only', () => {
    const remove = ar('operations.shipment.receiptImage.delete');
    expect(preview([VIEW, EDIT])).toContain(remove);
    expect(preview([VIEW])).not.toContain(remove);
  });

  it('offers no delete, to anyone, when opened from a screen that only looks', () => {
    const html = render(
      [VIEW, EDIT],
      <ShipmentReceiptImagePreviewDialog
        open
        onClose={() => undefined}
        row={WITH_PHOTO}
        readOnly
      />,
    );
    expect(html).toContain(ar('common.close'));
    expect(html).not.toContain(ar('operations.shipment.receiptImage.delete'));
  });

  it('renders nothing while closed', () => {
    expect(
      render(
        [VIEW, EDIT],
        <ShipmentReceiptImagePreviewDialog open={false} onClose={() => undefined} row={null} />,
      ),
    ).toBe('');
  });
});

// Nothing else connects this client to the server's three routes: typecheck sees a string on one
// side and an Express path on the other. The server mounts `/:id/receipt-image` under the shipments
// prefix and reads the photo with multer's `.single('file')`, so a renamed path is a 404 and a
// renamed part is the 400 «a file part named "file" is required». Both would only show in the
// browser (the IT module pins its own multipart field the same way).
describe('the receipt-image requests', () => {
  const PATH = '/operations/shipments/s-1/receipt-image';

  it('uploads the photo as the multipart part named `file`, to the shipment’s receipt-image path', async () => {
    const photo = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'receipt.png', {
      type: 'image/png',
    });
    await uploadShipmentReceiptImage('s-1', photo);
    expect(vi.mocked(upload)).toHaveBeenCalledTimes(1);
    const [path, form] = vi.mocked(upload).mock.calls[0] as [string, FormData];
    expect(path).toBe(PATH);
    const part = form.get('file');
    expect(part).toBeInstanceOf(File);
    expect((part as File).name).toBe('receipt.png');
    expect((part as File).type).toBe('image/png');
    // One part only — the server takes a single file and nothing else.
    expect([...form.keys()]).toEqual(['file']);
  });

  it('reads the bytes with the session and deletes on the same path', async () => {
    await fetchShipmentReceiptImage('s-1');
    expect(vi.mocked(fetchBlob)).toHaveBeenCalledWith(PATH);
    await deleteShipmentReceiptImage('s-1');
    expect(vi.mocked(del)).toHaveBeenCalledWith(PATH);
  });
});
