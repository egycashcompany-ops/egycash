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
//   · «لو موجوده عندنا لا ك محصنة يبقى مينفعش ولو دخلت وخرجت واتكرر يبقى عادى» (Round 21b): the receive
//     form's seal check POSTs the seals in its body, with the signal that lets a stale one be
//     stopped, and a check that fails answers "not known" — never an error the form must handle.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, del, get, post } from '../../../shared/lib/api-client';
import { __askVaultSeals } from './operations-queries';
import {
  cancelVaultReceipt,
  checkVaultSeals,
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
    api: vi.fn(async () => ({ held: [] })),
  };
});

beforeEach(() => {
  vi.mocked(get).mockClear();
  vi.mocked(post).mockClear();
  vi.mocked(del).mockClear();
  vi.mocked(api).mockClear();
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

describe('the receive form’s seal check (Round 21b)', () => {
  it('POSTs the seals and the shipment being received in the body — with the signal', async () => {
    const signal = new AbortController().signal;
    await checkVaultSeals({ seals: ['7', '21'], excludeShipmentId: 's-4' }, { signal });
    expect(api).toHaveBeenCalledWith('/operations/secured/seal-check', {
      method: 'POST',
      body: JSON.stringify({ seals: ['7', '21'], excludeShipmentId: 's-4' }),
      signal,
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('asks without a signal when none is given — and sends no shipment when there is none', async () => {
    await checkVaultSeals({ seals: ['7'] });
    expect(api).toHaveBeenCalledWith('/operations/secured/seal-check', {
      method: 'POST',
      body: JSON.stringify({ seals: ['7'] }),
    });
    await __askVaultSeals(['7'], null, new AbortController().signal);
    expect(vi.mocked(api).mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ seals: ['7'] }));
  });

  it('answers what the vault said, or null when it could not be asked — never a thrown error', async () => {
    const answer = { held: [] };
    vi.mocked(api).mockResolvedValueOnce(answer);
    expect(await __askVaultSeals(['7'], 's-1', new AbortController().signal)).toBe(answer);
    vi.mocked(api).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await __askVaultSeals(['7'], 's-1', new AbortController().signal)).toBeNull();
  });

  it('lets an overtaken check fail as TanStack cancelled it — no answer for seals no longer typed', async () => {
    const asked = new AbortController();
    asked.abort();
    vi.mocked(api).mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    await expect(__askVaultSeals(['7'], 's-1', asked.signal)).rejects.toThrow('aborted');
  });
});
