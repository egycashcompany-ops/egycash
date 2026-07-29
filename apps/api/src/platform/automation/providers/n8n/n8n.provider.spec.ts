// The n8n provider (A-5, trigger path).
//
// `fetch` is stubbed. These pin the two behaviours A-5 delivers — dispatch posts the payload to
// the workflow's webhook, health reports reachability without throwing — and the boundary of the
// slice: workflow authoring rejects clearly rather than pretending, until A-6.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { N8nAutomationProvider, N8nNotImplementedError } from './n8n.provider';

const ok = (): Response =>
  ({ ok: true, status: 200, text: () => Promise.resolve('{}') }) as unknown as Response;

const provider = () =>
  new N8nAutomationProvider({ baseUrl: 'https://n8n.example', maxRetries: 0, timeoutMs: 2_000 });

const dispatchInput = () => ({
  executionId: 'ex_1',
  payload: { employeeId: 'e1' },
  actor: { userId: 'u1', branchId: 'b1' },
  depth: 0,
});

afterEach(() => vi.restoreAllMocks());

describe('dispatch', () => {
  it('posts to the workflow′s n8n webhook and returns an execution ref', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());
    const ref = await provider().dispatch({ providerId: 'n8n', ref: 'wh-token' }, dispatchInput());

    expect(fetchMock).toHaveBeenCalledWith(
      'https://n8n.example/webhook/wh-token',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(ref).toEqual({ providerId: 'n8n', ref: 'ex_1' });
  });

  it('propagates a transport failure (automationService turns it into a best-effort skip)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      provider().dispatch({ providerId: 'n8n', ref: 'wh' }, dispatchInput()),
    ).rejects.toBeTruthy();
  });
});

describe('health', () => {
  it('reports reachable without throwing when n8n answers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok());
    expect(await provider().health()).toMatchObject({ providerId: 'n8n', reachable: true });
  });

  it('reports unreachable rather than throwing when n8n is down', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ENOTFOUND'));
    expect(await provider().health()).toMatchObject({ providerId: 'n8n', reachable: false });
  });
});

describe('the scope boundary', () => {
  it('declares only trigger-path capabilities (authoring lights up at A-6)', () => {
    expect(provider().capabilities).toEqual({
      visualBuilder: false,
      graphImportExport: false,
      cancellation: false,
      perNodeProgress: false,
    });
  });

  it('rejects workflow authoring clearly instead of faking it', async () => {
    const p = provider();
    await expect(p.createWorkflow({ key: 'k', name: 'n', trigger: { kind: 'manual', timezone: 'Africa/Cairo', filters: [] } })).rejects.toBeInstanceOf(
      N8nNotImplementedError,
    );
    await expect(p.exportGraph()).rejects.toBeInstanceOf(N8nNotImplementedError);
  });
});
