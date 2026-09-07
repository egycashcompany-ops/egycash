import { describe, expect, it } from 'vitest';
import { diagnoseUri, looksLikeMongoUri, resolveUri } from './args';

const none = {};

describe('resolveUri', () => {
  it('reads --uri <value>', () => {
    expect(resolveUri(['--uri', 'mongodb://a/b'], none)).toBe('mongodb://a/b');
  });

  it('reads --uri=<value>', () => {
    expect(resolveUri(['--uri=mongodb+srv://u:p@h/db'], none)).toBe('mongodb+srv://u:p@h/db');
  });

  it('accepts a bare mongodb:// argument — the flag is what gets lost between nested npm layers', () => {
    // This is the exact shape that reached the process on Windows: the operator typed --uri, the
    // value survived two `npm run … --` hand-offs, the flag did not.
    expect(resolveUri(['mongodb+srv://u:p@cluster.example.net/ecms'], none)).toBe(
      'mongodb+srv://u:p@cluster.example.net/ecms',
    );
    expect(resolveUri(['--json', 'mongodb://localhost:27017/ecms'], none)).toBe(
      'mongodb://localhost:27017/ecms',
    );
  });

  it('falls back to MONGO_URI', () => {
    expect(resolveUri([], { MONGO_URI: 'mongodb://from-env' })).toBe('mongodb://from-env');
  });

  it('prefers what was typed over what the shell happens to hold', () => {
    // A stale MONGO_URI pointing at a dev database must not silently win over the production
    // cluster the operator just named. Explicit first, always.
    expect(resolveUri(['--uri', 'mongodb://typed'], { MONGO_URI: 'mongodb://stale' })).toBe(
      'mongodb://typed',
    );
    expect(resolveUri(['mongodb://typed'], { MONGO_URI: 'mongodb://stale' })).toBe('mongodb://typed');
  });

  it('returns empty when nothing names a database, so the caller can print one instruction', () => {
    expect(resolveUri(['--json'], none)).toBe('');
    expect(resolveUri([], { MONGO_URI: '   ' })).toBe('');
  });

  it('does not mistake other arguments for a URI', () => {
    expect(looksLikeMongoUri('--json')).toBe(false);
    expect(looksLikeMongoUri('org-report.json')).toBe(false);
    expect(looksLikeMongoUri('mongodb:mongodb+srv://x')).toBe(false);
  });
});

describe('diagnoseUri', () => {
  it('names a doubled scheme — the shape an operator actually produced, twice', () => {
    // Pasting an Atlas string into a template that already began with `mongodb:` yields this.
    const why = diagnoseUri(['mongodb:mongodb+srv://user:s3cret@cluster.example.net/ecms']);
    expect(why).toContain('doubled');
    expect(why).toContain('mongodb:mongodb+srv://');
  });

  it('never echoes anything past the scheme — what follows is the credential', () => {
    const why = diagnoseUri(['mongodb:mongodb+srv://user:s3cret@cluster.example.net/ecms']);
    expect(why).not.toContain('s3cret');
    expect(why).not.toContain('user');
    expect(why).not.toContain('cluster.example.net');
  });

  it('says nothing when no argument tried to be a connection string', () => {
    expect(diagnoseUri(['--json'])).toBeNull();
    expect(diagnoseUri([])).toBeNull();
  });

  it('says nothing when the URI is valid — that case is handled by resolveUri', () => {
    expect(diagnoseUri(['mongodb+srv://u:p@h/db'])).toBeNull();
  });

  it('still refuses to resolve the doubled form, so the diagnosis is what the operator sees', () => {
    expect(resolveUri(['mongodb:mongodb+srv://u:p@h/db'], {})).toBe('');
  });
});
