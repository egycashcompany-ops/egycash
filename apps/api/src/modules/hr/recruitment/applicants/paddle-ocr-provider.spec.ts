// The local OCR provider's contract with the seam.
//
// What matters here is not the happy path — it is that every way the sidecar can misbehave
// degrades to "no fields" rather than to bad data or a failed request. National-ID OCR is an
// assist: when it cannot help, the user types the card in, and recruitment continues. A provider
// that threw, or that passed a malformed value through to the review dialog, would turn an
// optional convenience into an outage.
//
// `fetch` and the Files service are stubbed, so these run with no sidecar and no database.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setOutboundPolicyForTests } from '../../../../infrastructure/http/outbound';

// The outbound policy pins what the environment configured; this spec configured nothing, so it
// pins the fake sidecar itself. The policy has its own spec.
beforeAll(() =>
  setOutboundPolicyForTests({ allowHosts: [], pinnedHosts: ['nid-ocr', 'x'], allowPrivate: false }),
);
afterAll(() => setOutboundPolicyForTests(null));

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

// The new sidecar answers `quality`, `diagnostics` and `elapsedMs` alongside the fields it always
// returned. They are ADDITIVE: the provider reads none of them, and nothing about them reaches
// `RawOcrResult` or the review dialog.
//
// So the thing worth pinning is not that they are read — it is that they are IGNORED, and ignored
// safely. The failure this guards against is a provider that starts walking the new blocks to
// surface a quality hint, trusting their shape because the type names them; the sidecar is a
// separate process on its own release cadence, and a block of it arriving malformed must still
// leave a good read intact. A card someone photographed well should not stop extracting because
// the sidecar's quality scorer regressed.
describe('PaddleNationalIdOcrProvider — the sidecar‘s additive blocks', () => {
  const fields = {
    nationalId: { value: '28709011202408', confidence: 'high' },
    fullNameAr: { value: 'ندى محمد', confidence: 'medium' },
  };
  const extracted = {
    nationalId: { value: '28709011202408', confidence: 'high' },
    fullNameAr: { value: 'ندى محمد', confidence: 'medium' },
  };

  it('extracts unchanged from a response carrying quality, diagnostics and elapsedMs', async () => {
    respond({
      fields,
      layoutProfile: 'egypt-nid',
      elapsedMs: 1843.2,
      quality: {
        front: { verdict: 'ok', reasons: [], metrics: { cardWidthPx: 1024, sharpness: 182.4 } },
        back: { verdict: 'degraded', reasons: ['glare'], metrics: { glare: 0.21 } },
      },
      diagnostics: {
        front: { lines: 11, boxes: { profile: 6, detector: 5 } },
        back: { lines: 7, boxes: { profile: 7 }, detectionFailed: true },
      },
    });
    expect(await provider.extract({ frontFileId: 'f1', backFileId: 'b1', actor: ctx })).toEqual(
      extracted,
    );
  });

  // Each of these is a different way the block can be wrong, and none of them is about the fields.
  // A `quality` that is a string, an array, null, or an object whose per-side entries are not
  // objects at all — every one must leave the extraction untouched rather than throw out of
  // `sanitize` and degrade the whole read to `{}`.
  it.each([
    ['a string', 'ok'],
    ['an array', ['ok']],
    ['null', null],
    ['a number', 7],
    ['per-side primitives', { front: 'ok', back: 3 }],
    ['per-side nulls', { front: null, back: null }],
    ['reasons that are not a list', { front: { verdict: 'ok', reasons: 'glare' } }],
    ['no metrics at all', { front: { verdict: 'reject' } }],
  ])('still extracts when `quality` is %s', async (_label, quality) => {
    respond({ fields, quality, diagnostics: null, elapsedMs: 'not-a-number' });
    expect(await provider.extract({ frontFileId: 'f1', actor: ctx })).toEqual(extracted);
  });

  // The block being absent is the OLD sidecar's response, which must keep working for exactly as
  // long as someone is still running one.
  it('still extracts when the blocks are absent entirely, as the old sidecar answered', async () => {
    respond({ fields, layoutProfile: 'egypt-nid' });
    expect(await provider.extract({ frontFileId: 'f1', actor: ctx })).toEqual(extracted);
  });

  // A malformed block must not rescue a malformed FIELD. The field rules are unchanged: an
  // unknown confidence band is still dropped, however healthy the quality verdict beside it.
  it('does not let a healthy quality verdict admit a field with a bad band', async () => {
    respond({
      fields: { nationalId: { value: '28709011202408', confidence: 'excellent' } },
      quality: { front: { verdict: 'ok', reasons: [], metrics: {} } },
    });
    expect(await provider.extract({ frontFileId: 'f1', actor: ctx })).toEqual({});
  });
});
