// How a declared index is found on the server — by name. Getting a default name wrong would make
// the sync see a present index as missing on every deploy, and `createIndex` under a second name
// for the same keys is refused, so the sync would report a failure forever.
import { describe, expect, it } from 'vitest';
import { defaultIndexName, indexBuildPlan, indexNameOf } from './index-plan';

describe('the name an index is found under', () => {
  it('is the declared name when there is one', () => {
    const [entry] = indexBuildPlan([[{ userId: 1 }, { name: 'ix_user', background: true }]]);
    expect(indexNameOf(entry!)).toBe('ix_user');
  });

  it("is MongoDB's own default otherwise: each key and its direction, joined by underscores", () => {
    expect(defaultIndexName({ a: 1, b: -1 })).toBe('a_1_b_-1');
    expect(defaultIndexName({ 'personal.nationalId': 1 })).toBe('personal.nationalId_1');
    const [entry] = indexBuildPlan([[{ status: 1, createdAt: -1 }, { background: true }]]);
    expect(indexNameOf(entry!)).toBe('status_1_createdAt_-1');
  });

  it('names a text index the way MongoDB does', () => {
    expect(defaultIndexName({ code: 'text' })).toBe('code_text');
    expect(defaultIndexName({ title: 'text', body: 'text' })).toBe('title_text_body_text');
  });
});
