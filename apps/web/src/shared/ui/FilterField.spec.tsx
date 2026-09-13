// One filter's NAME sits above its VALUE — and has to look like it belongs to it.
//
// The name is the only thing telling a reader what each box in a bar of nine or eleven is for, so
// two things about it are load-bearing and neither is obvious from reading the component:
//
//   1. IT LINES UP WITH THE VALUE IT NAMES. The label's own side padding has to match the gutter
//      of the control below it. At `px-0.5` over a `tight` control's `px-2` the name starts six
//      pixels outboard of the text it belongs to; eleven of them side by side and the row of
//      names reads as a separate, slightly-misplaced strip floating above the bar. That is what
//      «العناوين اللى فوق لازم تتظبط» was about, and it is a one-class fix that a tidy-up would
//      silently undo.
//
//   2. IT DOES NOT SIZE THE COLUMN. The label truncates inside a `min-w-0` column, which is the
//      whole reason a bar can give every filter an equal width regardless of how long each
//      filter's name happens to be. Padding added to a truncating label cannot push the column
//      wider — but a label that stopped truncating would.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FilterField } from './FilterField';
import { Input, Select } from './form';

const render = (node: JSX.Element): string => renderToStaticMarkup(node);
/** The label is the field's first child; the control follows it. */
const labelClasses = (markup: string): string => {
  const at = markup.indexOf('<span');
  return markup.slice(markup.indexOf('class="', at) + 7, markup.indexOf('"', markup.indexOf('class="', at) + 7));
};

describe('a filter name lines up with the value it names', () => {
  it('takes the same side gutter as a tight control', () => {
    const markup = render(
      <FilterField label="التخصص" density="tight">
        <Select density="tight" aria-label="التخصص">
          <option value="">الكل</option>
        </Select>
      </FilterField>,
    );
    expect(labelClasses(markup), 'px-2, the same as `controlGutter("tight")`').toContain('px-2');
    expect(labelClasses(markup), 'and not the old hairline inset').not.toContain('px-0.5');
    expect(markup, 'the control it names is the tight one').toContain('px-2');
  });

  it('takes the wider gutter when the control below it is the default size', () => {
    const markup = render(
      <FilterField label="المبلغ">
        <Input aria-label="المبلغ" readOnly value="" />
      </FilterField>,
    );
    expect(labelClasses(markup), 'px-3, the same as `controlGutter("default")`').toContain('px-3');
  });

  it('is legible: 12px with a real line box, not 11px crushed to none', () => {
    // `leading-none` crops the Arabic hamza and the descenders that tell «الرخصة» from «الرخصه».
    const markup = render(
      <FilterField label="صورة الرخصة">
        <Input aria-label="صورة الرخصة" readOnly value="" />
      </FilterField>,
    );
    expect(labelClasses(markup)).toContain('text-xs');
    expect(labelClasses(markup)).not.toContain('text-[11px]');
    expect(labelClasses(markup)).toContain('leading-4');
    expect(labelClasses(markup)).not.toContain('leading-none');
  });

  it('still truncates, and still refuses to size its own column', () => {
    const markup = render(
      <FilterField label="اسم السائق أو كود الموظف" className="flex-1 basis-0 min-w-[4.5rem]">
        <Input aria-label="اسم" readOnly value="" />
      </FilterField>,
    );
    expect(labelClasses(markup), 'a name too long for its column ends honestly').toContain(
      'truncate',
    );
    expect(markup, 'and the column is the caller’s to size').toContain('min-w-0');
    expect(markup, 'the caller’s own share and floor survive').toContain(
      'flex-1 basis-0 min-w-[4.5rem]',
    );
  });

  it('colours the name when the filter is doing something, and changes no geometry', () => {
    const off = render(
      <FilterField label="الفرع">
        <Input aria-label="الفرع" readOnly value="" />
      </FilterField>,
    );
    const on = render(
      <FilterField label="الفرع" active>
        <Input aria-label="الفرع" readOnly value="" />
      </FilterField>,
    );
    expect(labelClasses(off)).toContain('text-slate-500');
    expect(labelClasses(on)).toContain('text-brand-600');
    // The ONLY difference is colour: a filter bar that reflowed when a filter was set would move
    // every control the moment a reader used one.
    const strip = (cls: string): string =>
      cls.replace(/text-(?:slate|brand)-\d+/g, '').replace(/dark:text-(?:slate|brand)-\d+/g, '');
    expect(strip(labelClasses(on))).toBe(strip(labelClasses(off)));
  });
});

// ── the reset and whatever follows it line up with the CONTROLS ─────────────
//
// Every `FilterField` writes its question above its control, so a filter child is a label plus a
// box while the trailing group is a single 36px button. `items-center` on the row centred that
// group against the taller child, leaving the reset and the count floating level with the LABELS
// instead of the boxes — «الرقم وزرار ريست يكونوا فى نفس مستوى الفلاتر على صف واحد».
describe('the filter bar’s trailing group', () => {
  const BAR = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'FilterBar.tsx'),
    'utf8',
  );
  const CODE = BAR.split('\n')
    .filter((line) => {
      const t = line.trimStart();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');

  it('aligns itself to the end of the row, not to its middle', () => {
    const at = CODE.indexOf('ms-auto');
    expect(at, 'the trailing group is still pushed to the end').toBeGreaterThan(-1);
    expect(CODE.slice(at, CODE.indexOf('>', at)), 'and sits on the controls’ line').toContain(
      'self-end',
    );
  });

  it('leaves the row itself centring its filters', () => {
    // `items-end` on the ROW would drag every child down, including bars whose children carry no
    // label. Only the trailing group moves.
    expect(CODE).toContain('items-center gap-2 rounded-lg');
  });
});
