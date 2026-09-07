import { describe, expect, it } from 'vitest';
import { looksLikeMongoUri, resolveUri } from './args';

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
