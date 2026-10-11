// «عاوز اي مكان فيه تاريخ زى كدا شيل البيضا وخلى الملونه لما ادوس عليها تجبلى اختيار تاريخ» — and
// «أي مكان فيه تاريخ يبقى نفس الشكل».
//
// Every Fleet date box wears our coloured calendar, which opens its picker, and the browser's white
// one is hidden for that box alone. Three frames draw it — `FilterWithIcon` and `DesignField` when
// asked with `datePicker`, and `DateBox` always — and it reaches a box only while that box sits in
// one of them, so this is a CENSUS: a new Fleet date box in none of them fails here, and so does
// a `FilterWithIcon` or `DesignField` around a date box that does not ask.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import postcss, { type AtRule, type Rule } from 'postcss';
import tailwindcss from 'tailwindcss';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { type Locale } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { Input } from '../../shared/ui/form';
import { CALENDAR_TONE, DateBox, HIDE_NATIVE_PICKER, openBoxBeside } from './components/DateBox';
import { FILTER_ICON, FilterWithIcon } from './components/FilterWithIcon';
import { DesignField } from './components/FuelCardDialog';
import { DARK_FILTER_BAR } from './components/dark-filter-bar';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const FLEET = 'modules/fleet';

/**
 * Source with its comments blanked: a box named only in prose is not a box. Blanked rather than
 * cut, so a line number still points at the line in the file.
 */
const code = (rel: string): string =>
  readFileSync(join(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '');

const fleetFiles = (): string[] =>
  readdirSync(join(SRC, FLEET), { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/u.test(file) && !file.includes('.spec.'))
    .map((file) => `${FLEET}/${file.split('\\').join('/')}`)
    .sort();

/** A box the browser draws a calendar into: `type="date"`, or a type that can become one. */
const DATE_BOX =
  /\btype=(?:"(?:date|month|week|datetime-local)"|\{[^{}]*'(?:date|month|week|datetime-local)'[^{}]*\})/gu;
const dateBoxesIn = (source: string): number[] =>
  [...source.matchAll(DATE_BOX)].map((match) => match.index);

/** The three frames that can give a date box our calendar. */
const FRAMES = ['FilterWithIcon', 'DesignField', 'DateBox'] as const;
type FrameTag = (typeof FRAMES)[number];

interface Frame {
  tag: FrameTag;
  /** The opening tag, props and all. */
  open: string;
  /** Where what it wraps begins and ends in the source. */
  from: number;
  to: number;
}

/** The end of the opening tag at `at`: the first `>` outside the props' braces. */
const openEnd = (source: string, at: number): number => {
  let depth = 0;
  for (let end = at; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return end;
  }
  return source.length;
};

/** Every `<Tag …>…</Tag>` of a file — a frame inside one of its own kind closes first. */
const framesOf = (source: string, tag: FrameTag): Frame[] => {
  const found: Frame[] = [];
  const marks = new RegExp(`<${tag}\\b|</${tag}>`, 'gu');
  const stack: { open: string; from: number }[] = [];
  for (const mark of source.matchAll(marks)) {
    if (mark[0].startsWith('</')) {
      const opened = stack.pop();
      if (opened !== undefined) found.push({ tag, ...opened, to: mark.index });
      continue;
    }
    const end = openEnd(source, mark.index);
    const open = source.slice(mark.index, end + 1);
    if (open.endsWith('/>')) found.push({ tag, open, from: end + 1, to: end + 1 });
    else stack.push({ open, from: end + 1 });
  }
  return found;
};

/** A frame that draws our calendar: a `DateBox`, or one of the others asked with `datePicker`. */
const asks = (frame: Frame): boolean =>
  frame.tag === 'DateBox' ||
  // `datePicker={false}` names the prop and asks for nothing: the white calendar stays.
  (/\sdatePicker(?=[\s=/>])/u.test(frame.open) &&
    !/\sdatePicker=\{\s*(?:false|undefined|null)\s*\}/u.test(frame.open));

interface Box {
  file: string;
  line: number;
  /** The innermost frame around it, if any. */
  frame: Frame | undefined;
}

const census = (): { boxes: Box[]; frames: (Frame & { file: string; holds: number })[] } => {
  const boxes: Box[] = [];
  const frames: (Frame & { file: string; holds: number })[] = [];
  for (const file of fleetFiles()) {
    const source = code(file);
    const own = FRAMES.flatMap((tag) => framesOf(source, tag));
    const at = dateBoxesIn(source);
    for (const index of at) {
      const frame = own
        .filter((f) => f.from <= index && index < f.to)
        .sort((a, b) => b.from - a.from)[0];
      boxes.push({ file, line: source.slice(0, index).split('\n').length, frame });
    }
    for (const frame of own) {
      frames.push({
        ...frame,
        file,
        holds: at.filter((i) => frame.from <= i && i < frame.to).length,
      });
    }
  }
  return { boxes, frames };
};

/**
 * The Fleet date boxes that keep the browser's own calendar, counted per file. EMPTY: every one
 * wears ours. A box that truly cannot (a reason, written here beside it) is the only way in.
 */
const KEEPS_NATIVE: Record<string, number> = {};

describe('every Fleet date box opens through our calendar', () => {
  const { boxes, frames } = census();
  const where = (box: Box): string => `${box.file}:${box.line}`;

  it('a FilterWithIcon or DesignField around a date box asks for datePicker', () => {
    const missing = boxes
      .filter((box) => box.frame !== undefined && !asks(box.frame))
      .map((box) => `${where(box)} in <${box.frame?.tag ?? ''}>`);
    expect(
      missing,
      'a date box under a frame without `datePicker` shows the white calendar, and nothing of ours opens it',
    ).toEqual([]);
  });

  it('every other Fleet date box is a known one that keeps the browser calendar', () => {
    const outside: Record<string, number> = {};
    const lines: string[] = [];
    for (const box of boxes.filter((b) => b.frame === undefined)) {
      outside[box.file] = (outside[box.file] ?? 0) + 1;
      lines.push(where(box));
    }
    expect(
      outside,
      `a new Fleet date box (${lines.join(', ')}): put it in a \`DateBox\` (a form, a plain bar), a \`DesignField\` with \`datePicker\` (the design forms) or a \`FilterWithIcon\` with \`datePicker\` (the dark boards) — or list it in KEEPS_NATIVE with why`,
    ).toEqual(KEEPS_NATIVE);
  });

  it('our calendar is asked for only around ONE date box — the button opens the box beside it', () => {
    // None: a button with no box to open. Two: it opens the first, and the second keeps no calendar.
    const strays = frames
      .filter((frame) => asks(frame) && frame.holds !== 1)
      .map((frame) => `${frame.file} (${frame.holds}): ${frame.open.replace(/\s+/gu, ' ')}`);
    expect(strays).toEqual([]);
  });

  it('a frame that names datePicker only to turn it off is not asking', () => {
    const frame = (open: string): Frame => ({ tag: 'DesignField', open, from: 0, to: 0 });
    expect(asks(frame('<DesignField label="x" datePicker>'))).toBe(true);
    expect(asks(frame('<DesignField label="x" datePicker={{ disabled: true }}>'))).toBe(true);
    expect(asks(frame('<DesignField label="x" datePicker={false}>'))).toBe(false);
    expect(asks(frame('<FilterWithIcon icon={i} datePicker={undefined}>'))).toBe(false);
    expect(asks(frame('<FilterWithIcon icon={i}>'))).toBe(false);
  });

  it('finds the boxes it guards — the census is not vacuous', () => {
    expect(
      boxes.length,
      'every Fleet date box, the filters, the forms and the bars',
    ).toBeGreaterThanOrEqual(30);
    const filesWith = (tag: FrameTag): Set<string> =>
      new Set(frames.filter((f) => f.tag === tag && asks(f) && f.holds > 0).map((f) => f.file));
    const expectAll = (tag: FrameTag, files: string[]): void => {
      const seen = filesWith(tag);
      for (const file of files) expect(seen, `${tag} in ${file}`).toContain(`${FLEET}/${file}.tsx`);
    };
    expectAll('FilterWithIcon', [
      'pages/AttendancePage',
      'pages/DealershipPage',
      'pages/FuelCardsPage',
      'pages/LicenseExpensesPage',
      'pages/MaintenancePage',
      'pages/NoticesPage',
      'pages/OdometerPage',
      'pages/ReceiptsPage',
    ]);
    expectAll('DesignField', [
      'components/CorrectOdometerDialog',
      'components/FuelCardDialog',
      'components/MaintenanceDialogs',
      'components/ReceiptDialog',
      'components/RecordOdometerDialog',
      'components/UnavailabilityDialog',
      'components/VehicleFormDialog',
      'pages/LicenseExpenseEditorPage',
    ]);
    expectAll('DateBox', [
      'components/AccidentFormDialog',
      'components/DriverFormDialog',
      'components/DriverViolationsPanel',
      'components/ViolationDialogs',
      'pages/AccidentsPage',
      'pages/CustodyPage',
      'pages/NoticeEditorPage',
      'pages/NoticeSetupPage',
      'pages/RosterPage',
    ]);
    // The «of what month» lists wear the calendar too, but are lists, not date boxes.
    expect(
      frames.some(
        (f) =>
          f.tag === 'FilterWithIcon' && f.open.includes('FILTER_ICON.calendar') && f.holds === 0,
      ),
    ).toBe(true);
  });

  it('nothing in Fleet dresses up the white calendar any more — it is hidden, and only by a frame', () => {
    const dressed = fleetFiles().filter(
      (file) =>
        file !== `${FLEET}/components/DateBox.tsx` &&
        code(file).includes('calendar-picker-indicator'),
    );
    expect(
      dressed,
      'the old recoloured indicator (`DATE_ICON`) or a hide outside `DateBox`',
    ).toEqual([]);
    const css = readFileSync(join(SRC, 'styles.css'), 'utf8');
    expect(css, 'never hidden for the whole page').not.toContain('calendar-picker-indicator');
  });
});

const render = (node: JSX.Element, locale: Locale = 'en'): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
    },
  });
  return renderToStaticMarkup(<Provider store={store}>{node}</Provider>);
};
/** As it reaches the markup: `&` is written `&amp;` inside an attribute. */
const attr = (value: string): string => value.split('&').join('&amp;');
/** An attribute's value as written in the source: React writes `&` and `>` as entities. */
const unescape = (value: string): string =>
  value.split('&gt;').join('>').split('&lt;').join('<').split('&amp;').join('&');
/** The `class` of the first element of the markup. */
const firstClass = (markup: string): string => unescape(/class="([^"]*)"/u.exec(markup)?.[1] ?? '');
const buttonOf = (markup: string): string =>
  markup.slice(markup.indexOf('<button'), markup.indexOf('</button>'));
const TONE = 'text-cyan-600 dark:text-cyan-400';

const dateFilter = (label: string, locale: Locale = 'en'): string =>
  render(
    <FilterWithIcon icon={FILTER_ICON.calendar} tone={TONE} datePicker={{ label }}>
      <Input type="date" aria-label={label} value="" readOnly />
    </FilterWithIcon>,
    locale,
  );

const formDate = (props: { disabled?: boolean } = {}, locale: Locale = 'en'): string =>
  render(
    <DateBox label="Licence expiry" disabled={props.disabled}>
      <Input type="date" value="" readOnly disabled={props.disabled} />
    </DateBox>,
    locale,
  );

const designDate = (missing = false): string =>
  render(
    <DesignField label="Reading date" required missing={missing} datePicker>
      <Input type="date" value="" readOnly />
    </DesignField>,
  );

/** What every one of the three frames must say about its button, whatever its size. */
const isOurCalendar = (button: string, name: string): void => {
  expect(button, 'never submits the form around it').toContain('type="button"');
  expect(button).toContain(`aria-label="Pick a date: ${name}"`);
  expect(button).toContain('cursor-pointer');
  expect(button, 'a button the clicks reach').not.toContain('pointer-events-none');
  expect(button, 'reachable by Tab — nothing takes it out of the order').not.toContain(
    'tabindex="-1"',
  );
  expect(button, 'the cyan of the filters’ calendar').toContain(TONE);
  expect(button, 'purple is for what is pressed or picked').not.toMatch(
    /brand-|purple-|indigo-|violet-/u,
  );
  expect(button, 'the app’s purple ring is not drawn around the full-height button').toContain(
    'focus-visible:ring-0 focus-visible:ring-offset-0',
  );
  expect(button, 'its ring, in its own colour, hugs the icon').toMatch(
    /class="rounded p-0\.5 [^"]*group-focus-visible:ring-2 group-focus-visible:ring-current/u,
  );
};

describe('the coloured calendar of a date filter', () => {
  it('is a real button: never submits a form, named for the box it opens', () => {
    isOurCalendar(buttonOf(dateFilter('From')), 'From');
  });

  it('fits the box’s 24px icon gutter, its focus ring on the icon rather than the box', () => {
    const button = buttonOf(dateFilter('From'));
    // `!pl-6` / `!pr-6` = 6 (ps-1.5) + 2 (p-0.5) + 14 (the h-3.5 icon) + 2 (p-0.5): a press on
    // the box's first digits types, it does not land on the button.
    expect(button).toContain('ps-1.5');
    expect(button).toContain('h-3.5 w-3.5');
    expect(button, 'no end padding pushing it past the gutter').not.toMatch(/\bpe-/u);
  });

  it('speaks Arabic on an Arabic page', () => {
    expect(dateFilter('من', 'ar')).toContain('aria-label="اختيار التاريخ: من"');
  });

  it('hides the white calendar of its own box only', () => {
    expect(HIDE_NATIVE_PICKER, 'a rule on the box inside this filter, never on the page').toMatch(
      /^\[&_input::-webkit-calendar-picker-indicator\]:hidden$/u,
    );
    expect(firstClass(dateFilter('From'))).toContain(HIDE_NATIVE_PICKER);
  });

  it('a filter that is not a date keeps its icon a picture and its control untouched', () => {
    const markup = render(
      <FilterWithIcon icon={FILTER_ICON.plate} tone={TONE}>
        <Input aria-label="Plate" value="" readOnly />
      </FilterWithIcon>,
    );
    expect(markup).not.toContain('<button');
    expect(markup).toContain('pointer-events-none');
    expect(markup).not.toContain(attr(HIDE_NATIVE_PICKER));
  });

  it('a disabled date filter keeps a disabled calendar', () => {
    const markup = render(
      <FilterWithIcon
        icon={FILTER_ICON.calendar}
        tone={TONE}
        datePicker={{ label: 'To', disabled: true }}
      >
        <Input type="date" aria-label="To" value="" readOnly disabled />
      </FilterWithIcon>,
    );
    expect(buttonOf(markup)).toContain('disabled=""');
  });
});

describe('the calendar of a form’s date box (`DateBox`)', () => {
  it('is the same calendar — a real button, the filters’ cyan, never purple', () => {
    expect(CALENDAR_TONE).toBe(TONE);
    isOurCalendar(buttonOf(formDate()), 'Licence expiry');
    expect(formDate({}, 'ar')).toContain('aria-label="اختيار التاريخ: Licence expiry"');
  });

  it('hides the white calendar of its own box, and keeps the date’s text clear of ours', () => {
    const frame = firstClass(formDate());
    expect(frame).toContain(HIDE_NATIVE_PICKER);
    // 8 (ps-2) + 2 + 16 (the h-4 icon) + 2 = 28px of button; the text starts at 32, on the
    // PAGE's start side (a `dir="ltr"` date on an Arabic page included).
    const button = buttonOf(formDate());
    expect(button).toContain('ps-2');
    expect(button).toContain('h-4 w-4');
    expect(button, 'the whole height of the box, the icon at its middle').toContain('inset-y-0');
    for (const gutter of ['rtl:[&&>input]:!pr-8', 'ltr:[&&>input]:!pl-8']) {
      expect(frame).toContain(gutter);
    }
  });

  it('a disabled box keeps a disabled calendar; an open one a pressable one', () => {
    expect(buttonOf(formDate({ disabled: true }))).toContain('disabled=""');
    expect(buttonOf(formDate())).not.toContain('disabled=""');
  });
});

describe('the calendar of a design form’s date (`DesignField` `datePicker`)', () => {
  it('is the same calendar, named by the field’s label', () => {
    isOurCalendar(buttonOf(designDate()), 'Reading date');
  });

  it('hides the white calendar and keeps both ends clear — ours at the start, the «!» at the end', () => {
    const markup = designDate(true);
    const frame = unescape(/<div class="(relative [^"]*)"/u.exec(markup)?.[1] ?? '');
    expect(frame).toContain(HIDE_NATIVE_PICKER);
    expect(frame).toContain('[&>input]:!px-10');
    expect(markup, 'the refused box still draws its «!»').toContain('text-rose-400');
    expect(buttonOf(markup)).toContain('ps-3');
  });

  it('a design field that is not a date draws no calendar', () => {
    const markup = render(
      <DesignField label="Notes">
        <Input value="" readOnly />
      </DesignField>,
    );
    expect(markup).not.toContain('data-date-picker-button');
    expect(markup).not.toContain(attr(HIDE_NATIVE_PICKER));
  });
});

/**
 * Specificity of a selector as the browser counts it — ids, then classes / attributes /
 * pseudo-classes, then elements — with `:where(…)` counting nothing and escaped characters
 * belonging to the name they sit in.
 */
const specificity = (selector: string): [number, number, number] => {
  const s = selector.replace(/:where\((?:[^()]|\([^()]*\))*\)/gu, '');
  const count: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i] ?? '';
    if (ch === '\\') {
      i += 1;
    } else if (ch === '#') {
      count[0] += 1;
    } else if (ch === '.') {
      count[1] += 1;
    } else if (ch === '[') {
      count[1] += 1;
      i = s.indexOf(']', i);
    } else if (ch === ':') {
      if (s[i + 1] === ':') {
        count[2] += 1;
        i += 1;
      } else count[1] += 1;
    } else if (/[a-z]/iu.test(ch) && (i === 0 || /[\s>+~]/u.test(s[i - 1] ?? ''))) {
      count[2] += 1;
    }
  }
  return count;
};
const outranks = (a: [number, number, number], b: [number, number, number]): boolean =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

describe('the icon keeps its gap on a small computer screen (1024–1279)', () => {
  // The reviewer's finding: the dark bar's `lg:max-xl:[&_input]:!px-1.5` was as specific as the
  // icon filter's gutter and came later, so at that width the icon sat over the plate's text, the
  // notices' «من» and a date's first digit. Compiled here by Tailwind itself, as the app's CSS is.
  const compile = async (classes: string): Promise<{ bar: Rule[]; gutter: Rule[] }> => {
    const result = await postcss([
      tailwindcss({
        content: [{ raw: `<div class="${classes}"></div>`, extension: 'html' }],
        corePlugins: { preflight: false },
        darkMode: 'class',
      }),
    ]).process('@tailwind utilities;', { from: undefined });
    const bar: Rule[] = [];
    const gutter: Rule[] = [];
    result.root.walkRules((rule) => {
      const pads = rule.nodes.some(
        (node) => node.type === 'decl' && /^padding-(?:left|right)$/u.test(node.prop),
      );
      if (!pads) return;
      const media = (rule.parent as AtRule | undefined)?.type === 'atrule';
      if (media && rule.selector.includes('max-xl')) bar.push(rule);
      else if (rule.selector.includes('\\&\\&')) gutter.push(rule);
    });
    return { bar, gutter };
  };
  /** What the bar pads at that width, and the same element under a frame's gutter. */
  const TARGETS = [
    { name: 'a typed box', bar: / input$/u, gutter: />input(?::where\(|$)/u },
    {
      name: 'a list’s trigger',
      bar: / button\[aria-haspopup\]$/u,
      gutter: / button\[aria-haspopup\](?::where\(|$)/u,
    },
  ];
  const outranksAll = (ours: Rule[], theirs: Rule[]): void => {
    for (const rule of ours) {
      expect(rule.toString(), 'as firm as the bar’s').toContain('!important');
      for (const other of theirs) {
        expect(
          outranks(specificity(rule.selector), specificity(other.selector)),
          `${rule.selector} over ${other.selector}`,
        ).toBe(true);
      }
    }
  };

  it('every icon filter’s gutter outranks the bar’s small-screen padding, for a box and a list', async () => {
    const frame = firstClass(
      render(
        <FilterWithIcon icon={FILTER_ICON.plate}>
          <Input aria-label="Plate" value="" readOnly />
        </FilterWithIcon>,
      ),
    );
    const { bar, gutter } = await compile(`${frame} ${DARK_FILTER_BAR}`);
    for (const target of TARGETS) {
      const theirs = bar.filter((rule) => target.bar.test(rule.selector));
      const ours = gutter.filter((rule) => target.gutter.test(rule.selector));
      expect(theirs.length, `the bar pads ${target.name} at 1024–1279`).toBe(1);
      expect(ours.length, `the filter keeps a gutter on ${target.name}`).toBeGreaterThan(0);
      outranksAll(ours, theirs);
    }
  });

  it('a form’s date box keeps its gutter the same way, wherever it is put', async () => {
    const { bar, gutter } = await compile(`${firstClass(formDate())} ${DARK_FILTER_BAR}`);
    const box = TARGETS[0];
    const ours = gutter.filter((rule) => box !== undefined && box.gutter.test(rule.selector));
    expect(ours.length, 'both sides, both directions').toBe(4);
    outranksAll(
      ours,
      bar.filter((rule) => box !== undefined && box.bar.test(rule.selector)),
    );
  });

  it('counts specificity the browser’s way', () => {
    expect(specificity('.a input')).toEqual([0, 1, 1]);
    expect(specificity('.a.a>input:where([dir="rtl"], [dir="rtl"] *)')).toEqual([0, 2, 1]);
    expect(specificity('.lg\\:max-xl\\:\\[\\&_input\\]\\:\\!px-1\\.5 input')).toEqual([0, 1, 1]);
    expect(specificity('.a button[aria-haspopup]')).toEqual([0, 2, 1]);
  });
});

describe('pressing the calendar', () => {
  const beside = (box: unknown): HTMLElement =>
    ({ parentElement: { querySelector: vi.fn(() => box) } }) as unknown as HTMLElement;

  it('opens the picker of the box it sits on', () => {
    const box = { focus: vi.fn(), showPicker: vi.fn() };
    openBoxBeside(beside(box));
    expect(box.showPicker).toHaveBeenCalledTimes(1);
    expect(box.focus).toHaveBeenCalled();
  });

  it('falls back to the focus where the browser cannot open it', () => {
    const box = {
      focus: vi.fn(),
      showPicker: vi.fn(() => {
        throw new DOMException('refused', 'NotAllowedError');
      }),
    };
    expect(() => openBoxBeside(beside(box))).not.toThrow();
    expect(box.focus).toHaveBeenCalled();
  });

  it('opens it the caller’s way when the box must first turn into a date', () => {
    const box = { focus: vi.fn(), showPicker: vi.fn() };
    const own = vi.fn();
    openBoxBeside(beside(box), own);
    expect(own).toHaveBeenCalledWith(box);
    expect(box.showPicker, 'the caller opens it, after its own turn').not.toHaveBeenCalled();
  });

  it('does nothing, and does not throw, with no box beside it', () => {
    expect(() => openBoxBeside(beside(null))).not.toThrow();
    expect(() => openBoxBeside({ parentElement: null } as unknown as HTMLElement)).not.toThrow();
  });
});
