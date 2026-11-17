// The combobox's sizes, and the phone's (`density: 'touch'`, it-vehicle-checks-design.md §6.3).
//
// `apps/web` has no DOM to open a list in, so what a closed box renders is checked here, and the
// sizes of the parts that only an open box draws are checked where they live: `COMBOBOX_DENSITY`.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Combobox, COMBOBOX_DENSITY, createOffer } from './Combobox';

const box = (density?: 'default' | 'tight' | 'touch', value = ''): string =>
  renderToStaticMarkup(
    <Combobox
      value={value}
      options={['150', '215', 'كورولا 1']}
      onChange={() => undefined}
      emptyText="لا توجد نتائج"
      clearLabel="مسح"
      {...(density === undefined ? {} : { density })}
    />,
  );

/** The class attribute of the first element of `tag` in `html`. */
const classOf = (html: string, tag: string): string =>
  new RegExp(`<${tag}[^>]*class="([^"]*)"`).exec(html)?.[1] ?? '';

describe('COMBOBOX_DENSITY — the phone’s box', () => {
  const touch = COMBOBOX_DENSITY.touch;

  it('writes 16px text in the box and in every row, so iOS does not zoom', () => {
    expect(touch.input).toContain('text-base');
    expect(touch.option).toContain('text-base');
    expect(touch.input).not.toContain('text-sm');
  });

  it('gives each row a 48px target', () => {
    expect(touch.option).toContain('min-h-12');
    expect(touch.option).toContain('py-3');
  });

  it('gives the ✕ a 40px target, with room before the chevron', () => {
    expect(touch.clear).toContain('h-10');
    expect(touch.clear).toContain('w-10');
    // 8 (end-2) + 16 (chevron) + 8 (gap-2) + 40 (✕) = 72px, under the box's 80px trailing gutter.
    expect(touch.trailingGap).toBe('gap-2');
    expect(touch.input).toContain('pe-20');
  });

  it('caps the list at 17rem, so it ends above a phone keyboard', () => {
    expect(touch.list).toBe('max-h-[17rem]');
  });

  it('leaves the other two densities as they always were', () => {
    expect(COMBOBOX_DENSITY.default.input).toBe('px-3 pe-16 py-2 text-sm');
    expect(COMBOBOX_DENSITY.tight.input).toBe('px-2 pe-12 py-2 text-sm');
    expect(COMBOBOX_DENSITY.default.option).toBe('px-3 py-2 text-sm');
    // Neither sets a height of its own: `tallList` still decides theirs.
    expect(COMBOBOX_DENSITY.default.list).toBeNull();
    expect(COMBOBOX_DENSITY.tight.list).toBeNull();
  });
});

describe('a closed box', () => {
  it('with `touch`, carries the 16px text class on its input', () => {
    const input = classOf(box('touch'), 'input');
    expect(input).toContain('text-base');
    expect(input).not.toContain('text-sm');
    expect(input).toContain('py-3');
  });

  it('with `touch` and a value, draws the 40px ✕', () => {
    const html = box('touch', '150');
    expect(classOf(html, 'button')).toContain('h-10 w-10');
  });

  it('by default, keeps its 14px text', () => {
    const input = classOf(box(), 'input');
    expect(input).toContain('text-sm');
    expect(input).not.toContain('text-base');
  });
});

// The «add» row (`onCreate`) — what it offers, and when it offers nothing. The row itself only
// exists in an OPEN list, which this DOM-less suite cannot draw, so the rule is pinned here.
describe('createOffer — the «add what was typed» row', () => {
  const branches = ['فرع التحرير', 'فرع المعادي'];

  it('offers the typed text, trimmed, when no option is it', () => {
    expect(createOffer(branches, '  فرع شبرا ')).toBe('فرع شبرا');
  });

  it('offers nothing for a blank box', () => {
    expect(createOffer(branches, '')).toBeNull();
    expect(createOffer(branches, '   ')).toBeNull();
  });

  // Offering to create what already exists would make a duplicate the server refuses — and the
  // reader would never find the one that is there.
  it('offers nothing when the text already IS an option — alef and diacritics folded', () => {
    expect(createOffer(branches, 'فرع التحرير')).toBeNull();
    expect(createOffer(['الإسماعيلية'], 'الاسماعيلية')).toBeNull();
  });

  it('a PART of an option is still new — «فرع» alone is not «فرع التحرير»', () => {
    expect(createOffer(branches, 'فرع')).toBe('فرع');
  });

  it('matches against what an option SHOWS, so ids behind labels are compared by name', () => {
    const shown = (id: string): string => (id === 'b1' ? 'فرع التحرير' : id);
    expect(createOffer(['b1'], 'فرع التحرير', shown)).toBeNull();
    expect(createOffer(['b1'], 'فرع الزمالك', shown)).toBe('فرع الزمالك');
  });

  it('a closed box draws no «add» row, whatever it was given', () => {
    const html = renderToStaticMarkup(
      <Combobox
        value=""
        options={branches}
        onChange={() => undefined}
        emptyText="لا توجد نتائج"
        clearLabel="مسح"
        onCreate={() => undefined}
        createLabel={(text) => `+ إضافة «${text}»`}
      />,
    );
    expect(html).not.toContain('data-combobox-create');
  });
});
