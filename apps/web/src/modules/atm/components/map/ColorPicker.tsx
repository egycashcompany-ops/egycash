// «اللون» (docs/12-planning/atm-map-zones.md §8.8 `ColorPicker`, `Edit.dc.html:117-125`): the twelve
// palette swatches as a `radiogroup` of `radio`s, the «مقترح» tag on the suggested one while the
// zone is new, and «لون مخصص» — a native colour input plus a hex field.
//
// ONE STEP PER CHOICE. A swatch is one choice. The native colour input fires on every movement of
// its picker, so its colour is committed on the native `change` (when the picker closes), and the
// hex field on Enter or when it loses focus — otherwise one custom colour would fill the undo
// history with every shade passed on the way.
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { ZONE_PALETTE } from '../../lib/map-colors';

const HEX = /^#[0-9a-fA-F]{6}$/;

export const ColorPicker = ({
  value,
  suggested,
  onChange,
}: {
  value: string;
  /** The «مقترح» swatch; null once the zone has been saved. */
  suggested: string | null;
  onChange: (hex: string) => void;
}): JSX.Element => {
  const t = useT();
  const current = value.toLowerCase();
  const [hex, setHex] = useState(current);
  useEffect(() => setHex(current), [current]);
  const native = useRef<HTMLInputElement>(null);
  const emit = useRef(onChange);
  emit.current = onChange;
  useEffect(() => {
    const input = native.current;
    if (input === null) return undefined;
    const onNativeChange = (): void => emit.current(input.value.toLowerCase());
    input.addEventListener('change', onNativeChange);
    return () => input.removeEventListener('change', onNativeChange);
    // The input is remounted when the colour changes elsewhere (`key`), so listen to the new one.
  }, [current]);
  const commitHex = (): void => {
    if (HEX.test(hex)) onChange(hex.toLowerCase());
    else setHex(current);
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-slate-500 dark:text-slate-400">{t('atm.map.edit.color')}</span>
      <div
        role="radiogroup"
        aria-label={t('atm.map.edit.colorGroup')}
        className="grid grid-cols-6 gap-2"
      >
        {ZONE_PALETTE.map((colour) => {
          const on = colour.hex === current;
          const name = t(colour.nameKey);
          return (
            <button
              key={colour.key}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={name}
              title={name}
              onClick={() => onChange(colour.hex)}
              className={cn(
                'relative h-7 rounded-lg transition-transform hover:scale-105',
                on
                  ? 'shadow-[0_0_0_2px_#fff,0_0_0_4px_#0f172a]'
                  : 'shadow-[inset_0_0_0_1px_rgba(15,23,42,0.15)]',
              )}
              style={{ backgroundColor: colour.hex }}
            >
              {suggested === colour.hex && (
                <span className="absolute -top-2 start-1/2 whitespace-nowrap rounded-full bg-white px-1 text-[9px] font-semibold text-slate-700 shadow rtl:translate-x-1/2 ltr:-translate-x-1/2">
                  {t('atm.map.edit.suggested')}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <label className="flex items-center gap-2.5 text-[13px] text-slate-700 dark:text-slate-200">
        {t('atm.map.edit.custom')}
        <input
          ref={native}
          type="color"
          defaultValue={current}
          key={current}
          aria-label={t('atm.map.edit.custom')}
          className="h-[30px] w-11 cursor-pointer rounded-md border border-slate-300 bg-white p-0.5 dark:border-slate-600"
        />
        <input
          type="text"
          dir="ltr"
          value={hex}
          maxLength={7}
          spellCheck={false}
          aria-label={t('atm.map.edit.custom')}
          aria-invalid={!HEX.test(hex)}
          onChange={(event) => setHex(event.target.value.trim())}
          onBlur={commitHex}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitHex();
            }
          }}
          className="h-[30px] w-24 rounded-md border border-slate-300 bg-white px-2 font-mono text-xs text-slate-700 aria-[invalid=true]:border-red-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        />
      </label>
    </div>
  );
};
