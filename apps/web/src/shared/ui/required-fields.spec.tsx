// Save pressed with a required value missing: the banner names it, and its Field and box go red.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { type ReactNode } from 'react';
import { localeSlice } from '../../store/localeSlice';
import { Field, Input, Select, Textarea } from './form';
import { MoneyInput } from './MoneyInput';
import { Combobox } from './Combobox';
import { MultiSelect } from './MultiSelect';
import {
  MissingFieldsBanner,
  missingFields,
  useRequiredFields,
  type RequiredField,
} from './required-fields';

const render = (node: ReactNode): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: { locale: { locale: 'ar' as const, dir: 'rtl' as const } },
  });
  return renderToStaticMarkup(<Provider store={store}>{node}</Provider>);
};

const FIELDS: RequiredField[] = [
  { key: 'code', label: 'كود السيارة', ok: false },
  { key: 'type', label: 'نوع السيارة', ok: true },
  { key: 'plate', label: 'رقم اللوحة', ok: false },
];

describe('missingFields', () => {
  it('keeps only what is not filled in, in the order the form shows it', () => {
    expect(missingFields(FIELDS).map((field) => field.key)).toEqual(['code', 'plate']);
    expect(missingFields([{ key: 'x', label: 'x', ok: true }])).toEqual([]);
  });
});

describe('MissingFieldsBanner', () => {
  it('names every missing field, in Arabic, with the reason the save did not happen', () => {
    const html = render(<MissingFieldsBanner missing={missingFields(FIELDS)} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('لم يتم الحفظ.');
    expect(html).toContain('أدخل البيانات المطلوبة: كود السيارة، رقم اللوحة.');
    expect(html, 'a filled field is not named').not.toContain('نوع السيارة');
  });

  it('is nothing at all when nothing is missing — no empty red box', () => {
    expect(render(<MissingFieldsBanner missing={[]} />)).toBe('');
  });
});

describe('useRequiredFields — what one press of Save does', () => {
  /**
   * The web suite has no DOM to click in, so the form presses its own Save — once, from inside its
   * first render. That is a render-phase state update, which the server renderer replays at once:
   * the markup that comes back is the form as it reads AFTER the press. The «pressed» flag lives
   * outside the component so the replay does not press again (and again, until React gives up).
   *
   * `refill` stands for the user filling the boxes in after the refused press: the replay reads
   * those values instead of the ones the press was refused over.
   */
  const pressSave = (
    fields: RequiredField[],
    { press = true, refill }: { press?: boolean; refill?: RequiredField[] } = {},
  ): {
    html: string;
    save: ReturnType<typeof vi.fn>;
    seen: { isMissing: boolean; attempt: number };
  } => {
    const save = vi.fn();
    const pressed = { done: !press };
    const seen = { isMissing: false, attempt: 0 };
    let current = fields;
    const Form = (): JSX.Element => {
      const required = useRequiredFields(current);
      if (!pressed.done) {
        pressed.done = true;
        required.guard(save)();
        if (refill !== undefined) current = refill;
      }
      seen.isMissing = required.isMissing('code');
      seen.attempt = required.attempt;
      return <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />;
    };
    return { html: render(<Form />), save, seen };
  };

  it('with a required value missing: nothing is sent, the banner names it, its field is red', () => {
    const { html, save, seen } = pressSave(FIELDS);
    expect(save, 'the save never ran').not.toHaveBeenCalled();
    expect(html).toContain('data-missing-fields="true"');
    expect(html).toContain('كود السيارة، رقم اللوحة');
    expect(html, 'a filled field is not named').not.toContain('نوع السيارة');
    expect(seen.isMissing, 'its Field reads as missing').toBe(true);
    expect(seen.attempt, 'one refused press, counted').toBe(1);
  });

  it('with everything in: the save runs, once, and nothing turns red', () => {
    const filled = FIELDS.map((field) => ({ ...field, ok: true }));
    const { html, save, seen } = pressSave(filled);
    expect(save).toHaveBeenCalledTimes(1);
    expect(html, 'no banner').toBe('');
    expect(seen.isMissing).toBe(false);
    expect(seen.attempt, 'a press that saved is not a refused one').toBe(0);
  });

  it('before Save is pressed: no banner, nothing red — even with every value missing', () => {
    const { html, save, seen } = pressSave(FIELDS, { press: false });
    expect(save).not.toHaveBeenCalled();
    expect(html).toBe('');
    expect(seen.isMissing).toBe(false);
  });

  it('a value filled in after the refused press leaves the banner and loses its red', () => {
    const refill = FIELDS.map((field) => (field.key === 'code' ? { ...field, ok: true } : field));
    const { html, save, seen } = pressSave(FIELDS, { refill });
    expect(save).not.toHaveBeenCalled();
    expect(html, 'the one still missing is still named').toContain('رقم اللوحة');
    expect(html, 'the one filled in is not').not.toContain('كود السيارة');
    expect(seen.isMissing).toBe(false);
  });
});

describe('a Field marked missing', () => {
  const red = /border-red-400/u;

  it('turns its label red and says «حقل مطلوب» under the box', () => {
    const html = render(
      <Field label="رقم اللوحة" required missing>
        <Input value="" onChange={() => undefined} />
      </Field>,
    );
    expect(html).toContain('data-field-missing="true"');
    expect(html).toContain('حقل مطلوب');
    expect(html).toMatch(/<label[^>]*text-red-600/u);
  });

  it('turns every kind of box inside it red, with no prop passed to the box', () => {
    const boxes: [string, ReactNode][] = [
      ['Input', <Input key="i" value="" onChange={() => undefined} />],
      ['Textarea', <Textarea key="t" value="" onChange={() => undefined} />],
      // A box with a `rule` renders through its own component (`RuledInput`, `RuledTextarea`),
      // which has to be handed the mark as well — it is not the plain box's path.
      [
        'Input rule="integer"',
        <Input key="ri" rule="integer" value="" onChange={() => undefined} />,
      ],
      [
        'Textarea rule="arabic"',
        <Textarea key="rt" rule="arabic" value="" onChange={() => undefined} />,
      ],
      [
        'Select',
        <Select key="s" value="" onChange={() => undefined}>
          <option value="">—</option>
        </Select>,
      ],
      ['MoneyInput', <MoneyInput key="m" value="" onChange={() => undefined} />],
      [
        'Combobox',
        <Combobox
          key="c"
          value=""
          options={[]}
          onChange={() => undefined}
          emptyText="—"
          clearLabel="x"
        />,
      ],
      [
        'MultiSelect',
        <MultiSelect key="ms" label="x" options={[]} value={[]} onChange={() => undefined} />,
      ],
    ];
    for (const [name, box] of boxes) {
      expect(render(<Field missing>{box}</Field>), `${name} goes red`).toMatch(red);
      expect(render(<Field>{box}</Field>), `${name} is not red otherwise`).not.toMatch(red);
    }
  });

  it('a more precise error wins over «حقل مطلوب»', () => {
    const html = render(
      <Field label="رقم الكارت" missing error="رقم الكارت أربعة أرقام على الأقل.">
        <Input value="12" onChange={() => undefined} />
      </Field>,
    );
    expect(html).toContain('رقم الكارت أربعة أرقام على الأقل.');
    expect(html).not.toContain('حقل مطلوب');
  });

  it('a Field that is not missing renders exactly as before', () => {
    const html = render(
      <Field label="ملاحظات" hint="اختياري">
        <Input value="" onChange={() => undefined} />
      </Field>,
    );
    expect(html).not.toContain('data-field-missing');
    expect(html).not.toContain('aria-invalid');
    expect(html).toContain('اختياري');
  });
});
