// Snapshot redaction (A-4).
//
// Organised around where a secret actually escapes rather than around the function's branches: a
// field nobody thought to name, a value pasted into a URL, a nested node output, a stringified
// blob. Each case here is a real path from "the workflow authenticated" to "the secret is in a
// retained execution snapshot a support engineer can open".
import { describe, expect, it } from 'vitest';
import { REDACTED, containsSecret, isSecretFieldName, redactSnapshot } from './redaction';

const SECRET = 'sk-live-9f2b7c41aa';

describe('redaction by field name', () => {
  it('redacts the obvious names', () => {
    const out = redactSnapshot({
      password: 'hunter2',
      apiKey: 'abc123',
      accessToken: 'xyz',
      clientSecret: 'shh',
    });
    expect(out).toEqual({
      password: REDACTED,
      apiKey: REDACTED,
      accessToken: REDACTED,
      clientSecret: REDACTED,
    });
  });

  it('matches case-insensitively and as a substring', () => {
    // A node's output invents its own field names; an exact-name list would miss the next one.
    for (const name of ['X-API-Key', 'refreshToken', 'PRIVATE_KEY', 'auth_header', 'sessionId']) {
      expect(isSecretFieldName(name), name).toBe(true);
    }
  });

  it('leaves ordinary fields alone', () => {
    for (const name of ['employeeId', 'status', 'name', 'count', 'branchId']) {
      expect(isSecretFieldName(name), name).toBe(false);
    }
  });

  it('redacts a whole subtree under a secret-named key, not just its strings', () => {
    const out = redactSnapshot({ credentials: { user: 'a', pass: 'b' } });
    expect(out).toEqual({ credentials: REDACTED });
  });

  it('catches a secret this process never held', () => {
    // The value-based pass cannot help here: the provider returned it, ECMS never sealed it.
    const out = redactSnapshot({ node: { output: { password: 'from-the-provider' } } });
    expect(JSON.stringify(out)).not.toContain('from-the-provider');
  });
});

describe('redaction by value', () => {
  it('redacts a known secret in a field with an innocent name', () => {
    const out = redactSnapshot({ note: `use ${SECRET} for now` }, { secrets: [SECRET] });
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  it('redacts it inside a URL, which no name list would catch', () => {
    const out = redactSnapshot(
      { url: `https://api.example.com/v1?token=${SECRET}&page=1` },
      { secrets: [SECRET] },
    );
    expect(out).toEqual({ url: `https://api.example.com/v1?token=${REDACTED}&page=1` });
  });

  it('redacts every occurrence, not only the first', () => {
    const out = redactSnapshot({ a: `${SECRET} and ${SECRET}` }, { secrets: [SECRET] });
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  it('reaches into arrays and deep nesting', () => {
    const out = redactSnapshot(
      { items: [{ headers: [{ v: `Bearer ${SECRET}` }] }] },
      { secrets: [SECRET] },
    );
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  it('ignores a very short "secret" rather than shredding the snapshot', () => {
    // A 3-character secret would match inside ordinary words and redact the whole payload, which
    // destroys the diagnostic value the snapshot exists for.
    const out = redactSnapshot({ note: 'the cat sat' }, { secrets: ['cat'] });
    expect(out).toEqual({ note: 'the cat sat' });
  });
});

describe('what it must not do', () => {
  it('never mutates the input', () => {
    // The caller is usually holding the REAL payload to hand to the provider. Redacting in place
    // would send `[redacted]` to the integration instead of the secret.
    const original = { password: 'hunter2', keep: 'me' };
    const copy = structuredClone(original);
    redactSnapshot(original);
    expect(original).toEqual(copy);
  });

  it('preserves non-secret data, types and structure', () => {
    const out = redactSnapshot({
      employeeId: '66a1b2c3d4e5f60718293a4b',
      count: 42,
      active: true,
      missing: null,
      tags: ['a', 'b'],
    });
    expect(out).toEqual({
      employeeId: '66a1b2c3d4e5f60718293a4b',
      count: 42,
      active: true,
      missing: null,
      tags: ['a', 'b'],
    });
  });

  it('survives a cyclic structure instead of hanging', () => {
    // Snapshots are attacker-influenced data. Dropping the subtree past the depth limit is the
    // safe failure: an omitted branch cannot leak, a passed-through one can.
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic.self = cyclic;
    expect(() => redactSnapshot(cyclic)).not.toThrow();
    expect(JSON.stringify(redactSnapshot(cyclic))).toContain('root');
  });

  it('handles primitives and empty input', () => {
    expect(redactSnapshot('plain')).toBe('plain');
    expect(redactSnapshot(null)).toBeNull();
    expect(redactSnapshot(undefined)).toBeUndefined();
    expect(redactSnapshot({})).toEqual({});
  });
});

describe('the last-resort check', () => {
  it('reports a secret that survived redaction', () => {
    // Used as an assertion at the write boundary: if this is ever true the snapshot is dropped
    // whole, because "we think we cleaned it" is not a standard to store a credential under.
    expect(containsSecret({ leaked: SECRET }, [SECRET])).toBe(true);
  });

  it('is quiet on a properly redacted snapshot', () => {
    const redacted = redactSnapshot({ url: `x?t=${SECRET}` }, { secrets: [SECRET] });
    expect(containsSecret(redacted, [SECRET])).toBe(false);
  });

  it('is quiet when there are no secrets in play', () => {
    expect(containsSecret({ anything: 'at all' }, [])).toBe(false);
  });
});
