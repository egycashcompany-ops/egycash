// The local OCR provider's contract with the seam.
//
// What matters here is not the happy path — it is that every way the sidecar can misbehave
// degrades to "no fields" rather than to bad data or a failed request. National-ID OCR is an
// assist: when it cannot help, the user types the card in, and recruitment continues. A provider
// that threw, or that passed a malformed value through to the review dialog, would turn an
// optional convenience into an outage.
//
// `fetch` and the Files service are stubbed, so these run with no sidecar and no database.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.mock` is hoisted above every top-level statement, so the stub has to be created inside
// `vi.hoisted` to exist by the time the factory runs.
const { readBuffer } = vi.hoisted(() => ({ readBuffer: vi.fn() }));
vi.mock('../../../../platform/files', () => ({ fileService: { readBuffer } }));

import { PaddleNationalIdOcrProvider } from './paddle-ocr-provider';
import { type AuthContext } from '../../../../shared/types';

const ctx = { userId: 'u1', permissions: {} } as unknown as AuthContext;
const provider = new PaddleNationalIdOcrProvider({ baseUrl: 'http://nid-ocr:8099/', retries: 0 });

const respond = (body: unknown, status = 200): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: status < 400, status, json: () => Promise.resolve(body) }),
  );
};

beforeEach(() => {
  readBuffer.mockResolvedValue({ doc: {}, buffer: Buffer.from('image-bytes') });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('PaddleNationalIdOcrProvider — happy path', () => {
  it('maps sidecar fields onto RawOcrResult, preserving the confidence band', async () => {
    respond({
      fields: {
        nationalId: { value: '28709011202408', confidence: 'high' },
        fullNameAr: { value: 'ندى محمد', confidence: 'medium' },
      },
    });
    const result = await provider.extract({ frontFileId: 'f1', actor: ctx });
    expect(result.nationalId).toEqual({ value: '28709011202408', confidence: 'high' });
    expect(result.fullNameAr).toEqual({ value: 'ندى محمد', confidence: 'medium' });
  });

  it('reads the images through the CALLER context, not a standing credential', async () => {
    respond({ fields: {} });
    await provider.extract({ frontFileId: 'f1', backFileId: 'b1', actor: ctx });
    expect(readBuffer).toHaveBeenCalledTimes(2);
    expect(readBuffer).toHaveBeenCalledWith(ctx, 'f1');
    expect(readBuffer).toHaveBeenCalledWith(ctx, 'b1');
  });

  it('sends only the side that was supplied', async () => {
    respond({ fields: {} });
    await provider.extract({ backFileId: 'b1', actor: ctx });
    const [, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { body: string },
    ];
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toHaveProperty('backImageBase64');
    expect(body).not.toHaveProperty('frontImageBase64');
  });

  it('never returns a derived field — parseNationalId owns those', async () => {
    // The sidecar offering them would be a bug; passing them on would create a second source of
    // truth for values the contract computes deterministically.
    respond({
      fields: {
        nationalId: { value: '28709011202408', confidence: 'high' },
        birthDate: { value: '1987-09-01', confidence: 'high' },
        gender: { value: 'female', confidence: 'high' },
        governorate: { value: 'Dakahlia', confidence: 'high' },
      },
    });
    const result = await provider.extract({ frontFileId: 'f1', actor: ctx });
    expect(Object.keys(result)).toEqual(['nationalId']);
  });
});

describe('PaddleNationalIdOcrProvider — untrusted sidecar output', () => {
  it('drops a field with an unknown confidence band', async () => {
    respond({ fields: { fullNameAr: { value: 'ندى', confidence: 'very-sure' } } });
    expect(await provider.extract({ frontFileId: 'f1', actor: ctx })).toEqual({});
  });

  it('drops an empty or whitespace-only value', async () => {
    respond({ fields: { address: { value: '   ', confidence: 'high' } } });
    expect(await provider.extract({ frontFileId: 'f1', actor: ctx })).toEqual({});
  });

  it('drops a non-string value rather than coercing it', async () => {
    respond({ fields: { nationalId: { value: 28709011202408, confidence: 'high' } } });
    expect(await provider.extract({ frontFileId: 'f1', actor: ctx })).toEqual({});
  });

  it('trims surrounding whitespace on values it keeps', async () => {
    respond({ fields: { religion: { value: '  مسلم  ', confidence: 'high' } } });
    const result = await provider.extract({ frontFileId: 'f1', actor: ctx });
    expect(result.religion?.value).toBe('مسلم');
  });

  it('survives a response with no fields at all', async () => {
    respond({});
    expect(await provider.extract({ frontFileId: 'f1', actor: ctx })).toEqual({});
  });
});

describe('PaddleNationalIdOcrProvider — degradation', () => {
  it('returns nothing when the sidecar is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await provider.extract({ frontFileId: 'f1', actor: ctx })).toEqual({});
  });

  it('returns nothing on a sidecar error status', async () => {
    respond({ error: 'boom' }, 500);
    expect(await provider.extract({ frontFileId: 'f1', actor: ctx })).toEqual({});
  });

  it('does not retry a 4xx — the same payload fails identically', async () => {
    const retrying = new PaddleNationalIdOcrProvider({ baseUrl: 'http://x', retries: 3 });
    respond({ error: 'bad request' }, 400);
    await retrying.extract({ frontFileId: 'f1', actor: ctx });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns nothing when the images cannot be read', async () => {
    readBuffer.mockRejectedValue(new Error('forbidden'));
    respond({ fields: { nationalId: { value: '28709011202408', confidence: 'high' } } });
    expect(await provider.extract({ frontFileId: 'f1', actor: ctx })).toEqual({});
  });

  it('never calls the sidecar without an actor to authorize the read', async () => {
    respond({ fields: {} });
    expect(await provider.extract({ frontFileId: 'f1' })).toEqual({});
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns nothing when neither side was supplied', async () => {
    respond({ fields: {} });
    expect(await provider.extract({ actor: ctx })).toEqual({});
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
