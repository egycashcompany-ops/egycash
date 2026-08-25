// What a sender is asked to write.
//
// This used to demand `{ ar, en }` for both the title and the body — four fields, two of them an
// English translation, in a company that works in Arabic. The English half was mandatory in the
// schema and pointless in practice, which is the combination that blocks a send at 11pm over a
// sentence nobody was going to read.
//
// The shape is pinned because loosening it back is invisible: a `{ar, en}` object is also "a
// value", and the form would simply start asking for two again.
import { describe, expect, it } from 'vitest';
import { CreateAnnouncementSchema } from './hr-announcement.js';

const announcement = (over: Record<string, unknown> = {}) =>
  CreateAnnouncementSchema.safeParse({
    title: 'تم نزول الراتب',
    body: 'تم إيداع رواتب هذا الشهر.',
    audience: { kind: 'everyone' },
    ...over,
  });

describe('an announcement is written once', () => {
  it('takes a plain title and body', () => {
    const result = announcement();
    expect(result.success).toBe(true);
    expect(result.data?.title).toBe('تم نزول الراتب');
  });

  it('refuses the old bilingual pair', () => {
    // Not merely unnecessary now — rejected, so nothing can quietly go on sending it.
    expect(announcement({ title: { ar: 'عنوان', en: 'Title' } }).success).toBe(false);
    expect(announcement({ body: { ar: 'نص', en: 'Body' } }).success).toBe(false);
  });

  it('still refuses an empty message', () => {
    // Dropping the second language must not drop the requirement to say something.
    expect(announcement({ title: '' }).success).toBe(false);
    expect(announcement({ body: '   ' }).success).toBe(false);
  });

  it('trims what it stores', () => {
    expect(announcement({ title: '  إعلان  ' }).data?.title).toBe('إعلان');
  });
});
