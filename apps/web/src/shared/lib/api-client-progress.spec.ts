// `uploadWithProgress` — the one upload that reports how far its bytes have gone («64%» on a
// contract's page while it rises). `fetch` cannot report an upload's progress, so it rides an
// `XMLHttpRequest`; these tests drive a fake one and prove it keeps `upload`'s contract: the same
// headers, the envelope read the same way, one silent refresh on an expired token, and a cancel
// that settles the promise.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClientModule from './api-client';

type ApiClient = typeof ApiClientModule;

interface Sent {
  method: string;
  url: string;
  headers: Record<string, string>;
  withCredentials: boolean;
  body: unknown;
}

/** What the fake server does with one request — answer, fail, or wait to be aborted. */
type Answer =
  | { status: number; body: unknown; progress?: [number, number][] }
  | { network: true }
  | { hang: true };

class FakeXhr {
  static answers: Answer[] = [];
  static sent: Sent[] = [];
  static refreshes = 0;
  status = 0;
  responseText = '';
  withCredentials = false;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private request: Sent = { method: '', url: '', headers: {}, withCredentials: false, body: null };

  open(method: string, url: string): void {
    this.request = { ...this.request, method, url };
  }
  setRequestHeader(name: string, value: string): void {
    this.request.headers[name] = value;
  }
  send(body: unknown): void {
    FakeXhr.sent.push({ ...this.request, withCredentials: this.withCredentials, body });
    const answer = FakeXhr.answers.shift();
    if (answer === undefined) throw new Error('unexpected request');
    if ('hang' in answer) return;
    queueMicrotask(() => {
      if ('network' in answer) {
        this.onerror?.();
        return;
      }
      for (const [loaded, total] of answer.progress ?? []) {
        this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
      }
      this.status = answer.status;
      this.responseText = JSON.stringify(answer.body);
      this.onload?.();
    });
  }
  abort(): void {
    this.onabort?.();
  }
}

const ok = (data: unknown, progress?: [number, number][]): Answer => ({
  status: 201,
  body: { success: true, data },
  ...(progress === undefined ? {} : { progress }),
});
const failure = (status: number, code: string, details?: unknown[]): Answer => ({
  status,
  body: { success: false, error: { code, message: code, details, requestId: 'r-1' } },
});

describe('uploadWithProgress', () => {
  let mod: ApiClient;

  beforeEach(async () => {
    vi.resetModules();
    FakeXhr.answers = [];
    FakeXhr.sent = [];
    FakeXhr.refreshes = 0;
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    // The silent refresh goes through `fetch`, as every other renewal does.
    vi.stubGlobal('fetch', async (): Promise<Response> => {
      FakeXhr.refreshes += 1;
      return new Response(JSON.stringify({ success: true, data: { accessToken: 'fresh' } }), {
        status: 200,
      });
    });
    mod = await import('./api-client');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the form with the session headers and reports the percentage as the bytes go', async () => {
    mod.setAccessToken('token-1');
    mod.setActiveBranch('branch-1');
    FakeXhr.answers.push(
      ok({ fileId: 'f-1' }, [
        [16, 100],
        [64, 100],
        [100, 100],
      ]),
    );
    const seen: number[] = [];
    const form = new FormData();
    const data = await mod.uploadWithProgress<{ fileId: string }>('/things/1/files', form, {
      onProgress: (percent) => seen.push(percent),
    });
    expect(data).toEqual({ fileId: 'f-1' });
    expect(seen).toEqual([16, 64, 100, 100]);
    const [sent] = FakeXhr.sent;
    expect(sent?.method).toBe('POST');
    expect(sent?.url.endsWith('/things/1/files')).toBe(true);
    expect(sent?.headers).toEqual({
      Authorization: 'Bearer token-1',
      'X-Active-Branch': 'branch-1',
    });
    expect(sent?.withCredentials).toBe(true);
    expect(sent?.body).toBe(form);
  });

  it("a refusal keeps the server's code and details, as `upload` does", async () => {
    FakeXhr.answers.push(
      failure(422, 'FILE_TYPE_NOT_ALLOWED', [{ field: 'file', code: 'X', message: 'm' }]),
    );
    await expect(mod.uploadWithProgress('/things/1/files', new FormData())).rejects.toMatchObject({
      code: 'FILE_TYPE_NOT_ALLOWED',
      status: 422,
      details: [{ field: 'file', code: 'X', message: 'm' }],
      requestId: 'r-1',
    });
  });

  it('an expired token is renewed once and the upload sent again from 0%', async () => {
    mod.setAccessToken('stale');
    FakeXhr.answers.push(failure(401, 'AUTH_TOKEN_EXPIRED'), ok({ fileId: 'f-2' }, [[50, 100]]));
    const seen: number[] = [];
    await expect(
      mod.uploadWithProgress('/things/1/files', new FormData(), {
        onProgress: (p) => seen.push(p),
      }),
    ).resolves.toEqual({ fileId: 'f-2' });
    expect(FakeXhr.refreshes).toBe(1);
    expect(FakeXhr.sent.map((s) => s.headers['Authorization'])).toEqual([
      'Bearer stale',
      'Bearer fresh',
    ]);
    expect(seen).toEqual([0, 50, 100]);
  });

  it('a dropped connection is a network failure, worded as `fetch` failures are', async () => {
    FakeXhr.answers.push({ network: true });
    await expect(mod.uploadWithProgress('/things/1/files', new FormData())).rejects.toBeInstanceOf(
      TypeError,
    );
  });

  it('a cancel aborts the request and rejects with an AbortError', async () => {
    FakeXhr.answers.push({ hang: true });
    const controller = new AbortController();
    const pending = mod.uploadWithProgress('/things/1/files', new FormData(), {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('an already-cancelled upload never leaves', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      mod.uploadWithProgress('/things/1/files', new FormData(), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeXhr.sent).toEqual([]);
  });
});
