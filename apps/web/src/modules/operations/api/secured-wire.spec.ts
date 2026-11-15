// Round 10 — what the secured acts put on the wire: the method, the path and the body each one
// sends. The screens' specs render what is offered; this pins where a click goes — a confirm that
// went out as the undo (or the other way round) would turn a row white that the desk meant yellow.
//
//   · «لو العمليات تم الاستلام من العمليات»: the desk's pickup ✓ is a POST, its undo a DELETE of the
//     same path — both carry the version the row was read at;
//   · «بس صلاحية خاصة تقدر تلغى استلام الخزينة»: the cancelled receipt POSTs its reason and version;
//   · «كله يبقى موجود فى تاريخ يتفلتر»: «صرف الخزينة» asks for every day with NO `date` key (the
//     server refuses an empty one), or for one delivery day;
//   · «يجيب اللى اتسلم واللى متسلمش ويجيب البداية كل اول شهر» (Round 11): the vault roll-up asks for
//     its period — `from` and `to` on the request, as the captain report's — at
//     `/reports/banks` since Round 14, when it became «تقرير البنوك».
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { del, get, post } from '../../../shared/lib/api-client';
import {
  cancelVaultReceipt,
  confirmSecuredPickup,
  getBankReport,
  getSecuredDispatchBoard,
  undoSecuredPickup,
} from './operations-api';

// Only the transport is stubbed; the paths and bodies are the real module's.
vi.mock('../../../shared/lib/api-client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../shared/lib/api-client');
  return {
    ...actual,
    get: vi.fn(async () => ({})),
    post: vi.fn(async () => ({})),
    del: vi.fn(async () => ({})),
  };
});

beforeEach(() => {
  vi.mocked(get).mockClear();
  vi.mocked(post).mockClear();
  vi.mocked(del).mockClear();
});

describe('the desk’s pickup ✓ and its undo', () => {
  it('confirms with a POST to the shipment’s pickup, carrying the row’s version', async () => {
    await confirmSecuredPickup('s-1', { version: 3 });
    expect(post).toHaveBeenCalledWith('/operations/secured/s-1/pickup', { version: 3 });
    expect(del).not.toHaveBeenCalled();
  });

  it('undoes with a DELETE of the same path — the version in its body', async () => {
    await undoSecuredPickup('s-2', { version: 7 });
    expect(del).toHaveBeenCalledWith('/operations/secured/s-2/pickup', { version: 7 });
    expect(post).not.toHaveBeenCalled();
  });
});

describe('the cancelled vault receipt', () => {
  it('POSTs its reason and the row’s version to the shipment’s cancel-receipt', async () => {
    await cancelVaultReceipt('s-3', { reason: 'أُدخلت بالخطأ', version: 5 });
    expect(post).toHaveBeenCalledWith('/operations/secured/s-3/cancel-receipt', {
      reason: 'أُدخلت بالخطأ',
      version: 5,
    });
  });
});

describe('«صرف الخزينة» — every shipment in the vault, or one delivery day', () => {
  it('leaves the day out entirely for every day — never an empty `date=`', async () => {
    await getSecuredDispatchBoard(null);
    await getSecuredDispatchBoard('');
    expect(vi.mocked(get).mock.calls.map(([path]) => path)).toEqual([
      '/operations/secured/dispatch-board',
      '/operations/secured/dispatch-board',
    ]);
  });

  it('asks for one delivery day by its date', async () => {
    await getSecuredDispatchBoard('2026-11-12');
    expect(get).toHaveBeenCalledWith('/operations/secured/dispatch-board?date=2026-11-12');
  });
});

describe('«تقرير البنوك» — the period of vault receipts (was «تجميع الخزينة»)', () => {
  it('carries `from` and `to` on the request, both days inclusive, at the screen’s own name', async () => {
    await getBankReport({ from: '2026-11-01', to: '2026-11-30' });
    expect(get).toHaveBeenCalledWith('/operations/reports/banks?from=2026-11-01&to=2026-11-30');
  });
});
