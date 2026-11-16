// «ألوان الأنواع» — the card «لوحة التشغيلة» opens from beside «الطاقم الثابت» (Round 24b).
//
// THE OWNER: «وعاوز فوق خالص جمب الطاقم الثابت لما ادوس عليها يفتح كارد زى جدول اقدر ادى كل نوع لون من
// الالوان». A TABLE: a row per type, in the board's type order (its strip's: the active types in the
// catalog's order, and an archived one while a row of the day still holds it); a column per swatch
// of the palette SHOWN — as many as there are live types (`paletteFor`), all twenty past twenty, said
// so. A press on a swatch gives that type that colour; two types may share one («أيوه عادي»).
//
// A CATALOG SAVE, NOT A BOARD STEP. Each press is the catalog's own update
// (`useRecolourOperationsShiftType` — `PATCH /operations/shift-types/:id` under
// `operationsCatalog.manage`, the grant the reference tab already uses; no new one). It is saved at
// once, the board recolours at once, and «تراجع» on the board never sees it. Without that grant the
// table is shown, read only, and says why.
//
// A type whose colour is not among the swatches shown (the palette shrank when a type was archived,
// or it was given a colour before Round 24b) is marked «خارج اللوحة»: its row has no pressed swatch,
// and any press brings it back onto the palette.
//
// A COMPUTER gets the board's dialog with the table; a PHONE gets Fleet's bottom sheet, each type a
// block of its own with its swatches wrapping under its name — no table wider than the screen.
import { useState, type KeyboardEvent } from 'react';
import { type Locale, type OperationsShiftTypeDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { ApiError } from '../../../shared/lib/api-client';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import { formatNumber } from '../../../shared/lib/format';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useAppSelector } from '../../../store';
import { DesignCancel, DesignDialog } from '../../fleet/components/DesignDialog';
import { BottomSheet } from '../../fleet/components/roster/RosterBottomSheet';
import { useRecolourOperationsShiftType } from '../api/operations-queries';
import {
  PALETTE,
  colourWearers,
  gridStep,
  inPalette,
  paletteFor,
  paletteOverflow,
  liveTypes,
  type PaletteColour,
} from '../lib/type-colours';
import { PLAN_ICON } from './crew-plan-icons';
import { SHIFT_TYPE_TONE, ShiftTypeTag, shiftTypeName } from './shift-type-look';

/** The dialog's width, by how many swatches a row carries: never wider than the table needs. */
const widthFor = (swatches: number): 'xl' | '2xl' | '3xl' | '4xl' =>
  swatches <= 7 ? 'xl' : swatches <= 11 ? '2xl' : swatches <= 15 ? '3xl' : '4xl';

/**
 * The arrows inside one type's swatches: along the line (the reading direction), Home / End to its
 * ends — the table's rows are separate groups, as a radio group is.
 */
const walkSwatches = (event: KeyboardEvent<HTMLElement>): void => {
  const buttons = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-swatch]'),
  );
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
  const next = gridStep(event.key, at, buttons.length, buttons.length, rtl);
  if (next === null || event.key === 'ArrowUp' || event.key === 'ArrowDown') return;
  event.preventDefault();
  buttons[next]?.focus();
};

export interface TypeColoursCardProps {
  open: boolean;
  onClose: () => void;
  /** The whole catalog, archived types included — the palette counts its live types. */
  types: readonly OperationsShiftTypeDto[];
  /** The types the card lists, in the board's order (its strip's). */
  listed: readonly OperationsShiftTypeDto[];
  /** `operationsCatalog.manage` — without it the table is read only. */
  canEdit: boolean;
  /** A phone: the bottom sheet, the swatches wrapping. */
  sheet: boolean;
}

export const TypeColoursCard = ({
  open,
  onClose,
  types,
  listed,
  canEdit,
  sheet,
}: TypeColoursCardProps): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const recolour = useRecolourOperationsShiftType();
  /** The type whose colour is on its way — its swatches wait for the answer. */
  const [saving, setSaving] = useState<string | null>(null);

  const palette = paletteFor(types);
  const overflow = paletteOverflow(types);
  const colourName = (colour: PaletteColour): string =>
    t(`operations.catalogs.shiftType.colours.${colour}`);
  /** A swatch's words: its colour, and every live type that wears it (two may). */
  const swatchWords = (colour: PaletteColour): string => {
    const wearers = colourWearers(types, colour).map((type) => shiftTypeName(type, locale));
    return wearers.length === 0
      ? t('operations.crewPlan.colour.unworn', { colour: colourName(colour) })
      : t('operations.crewPlan.colour.wornBy', {
          colour: colourName(colour),
          types: wearers.join('، '),
        });
  };

  const give = (type: OperationsShiftTypeDto, colour: PaletteColour): void => {
    if (!canEdit || saving !== null || type.colour === colour) return;
    setSaving(type.id);
    recolour.mutate(
      { type, colour },
      {
        onSuccess: () =>
          toast.success(
            t('operations.crewPlan.typeColours.saved', {
              type: shiftTypeName(type, locale),
              colour: colourName(colour),
            }),
          ),
        // A version another desk moved on since the card read it: said in words (the list is read
        // again as the save settles, so the next press carries the new version).
        onError: (failure) =>
          toast.error(
            failure instanceof ApiError && failure.status === 409
              ? t('operations.crewPlan.typeColours.stale')
              : errorMessage(failure, locale),
          ),
        onSettled: () => setSaving(null),
      },
    );
  };

  /** One type's swatches — a cell each in the table, a wrapping line on a phone. */
  const swatch = (type: OperationsShiftTypeDto, colour: PaletteColour): JSX.Element => {
    const on = type.colour === colour;
    const label = t('operations.crewPlan.typeColours.pick', {
      type: shiftTypeName(type, locale),
      colour: colourName(colour),
    });
    return (
      <button
        key={colour}
        type="button"
        data-swatch={colour}
        aria-pressed={on}
        aria-label={label}
        title={`${label} — ${swatchWords(colour)}`}
        // Read only without the grant: the swatches stay visible, and say so to a screen reader.
        aria-disabled={!canEdit || undefined}
        disabled={saving !== null && saving !== type.id}
        tabIndex={on || (!inPalette(palette, type.colour) && colour === palette[0]) ? 0 : -1}
        onClick={() => give(type, colour)}
        className={cn(
          'relative shrink-0 rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
          sheet
            ? 'dark:focus-visible:ring-offset-slate-900'
            : 'dark:focus-visible:ring-offset-[#121c3f]',
          sheet ? 'h-9 w-9' : 'h-7 w-7',
          SHIFT_TYPE_TONE[colour].dot,
          canEdit ? 'hover:scale-110' : 'cursor-default',
          on &&
            cn(
              'ring-2 ring-slate-900 ring-offset-2 dark:ring-white',
              sheet ? 'dark:ring-offset-slate-900' : 'dark:ring-offset-[#121c3f]',
            ),
          saving !== null && !on && 'opacity-60',
        )}
      >
        {on && (
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="absolute inset-0 m-auto h-3.5 w-3.5 text-white drop-shadow"
            fill="none"
            stroke="currentColor"
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        )}
      </button>
    );
  };

  /** The type's own cell: its tag, archived or off the palette marked, a spinner while it saves. */
  const typeCell = (type: OperationsShiftTypeDto): JSX.Element => {
    const outside = !inPalette(palette, type.colour);
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <ShiftTypeTag type={type} locale={locale} className="max-w-full" />
        {!type.isActive && (
          <span className="shrink-0 text-[10.5px] font-black text-amber-700 dark:text-amber-300">
            {t('operations.crewPlan.type.archived')}
          </span>
        )}
        {outside && (
          <span
            data-type-outside="true"
            title={t('operations.crewPlan.typeColours.outsideHint')}
            className="shrink-0 rounded border border-dashed border-amber-500 px-1 text-[10.5px] font-black text-amber-800 dark:border-amber-400/70 dark:text-amber-200"
          >
            {t('operations.crewPlan.typeColours.outside')}
          </span>
        )}
        {saving === type.id && <Spinner className="h-3.5 w-3.5 shrink-0" />}
      </span>
    );
  };

  const notices = (
    <>
      {!canEdit && (
        <p
          data-type-colours-read-only="true"
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12.5px] font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300"
        >
          {t('operations.crewPlan.typeColours.readOnly')}
        </p>
      )}
      {overflow && (
        <p
          data-type-colours-overflow="true"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] font-bold text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-100"
        >
          {t('operations.crewPlan.typeColours.overflow', {
            count: formatNumber(liveTypes(types).length, locale),
            max: formatNumber(PALETTE.length, locale),
          })}
        </p>
      )}
      {listed.length === 0 && (
        <p className="py-6 text-center text-[13px] font-bold text-slate-500 dark:text-slate-400">
          {t('operations.crewPlan.typeColours.empty')}
        </p>
      )}
    </>
  );

  const title = t('operations.crewPlan.typeColours.title');
  const subtitle = t('operations.crewPlan.typeColours.subtitle', {
    count: formatNumber(palette.length, locale),
  });

  if (sheet) {
    return (
      <BottomSheet
        open={open}
        onClose={onClose}
        title={title}
        subtitle={subtitle}
        name="type-colours"
        tall
      >
        <div className="space-y-3 px-3 py-2" data-type-colours="sheet">
          {notices}
          {listed.map((type) => (
            <section
              key={type.id}
              data-type-row={type.id}
              aria-busy={saving === type.id || undefined}
              className="space-y-2 rounded-xl border border-slate-200 p-2.5 dark:border-slate-700/80"
            >
              {typeCell(type)}
              <div
                role="group"
                aria-label={shiftTypeName(type, locale)}
                onKeyDown={walkSwatches}
                className="flex flex-wrap gap-2.5"
              >
                {palette.map((colour) => swatch(type, colour))}
              </div>
            </section>
          ))}
        </div>
      </BottomSheet>
    );
  }

  return (
    <DesignDialog
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      icon={PLAN_ICON.palette}
      width={widthFor(palette.length)}
      dense
      panelProps={{ 'data-type-colours': 'dialog' }}
      footer={<DesignCancel onClick={onClose} label={t('common.close')} />}
    >
      {notices}
      {listed.length > 0 && (
        // Wider than the dialog only past fifteen swatches on a small laptop: the table scrolls in
        // its own box, never the page.
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0" data-type-colours-table="true">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky start-0 z-[1] bg-white pb-2 pe-3 text-start text-[12px] font-black text-slate-500 dark:bg-[#121c3f] dark:text-slate-400"
                >
                  {t('operations.crewPlan.typeColours.type')}
                </th>
                {palette.map((colour) => (
                  <th
                    key={colour}
                    scope="col"
                    data-swatch-head={colour}
                    title={swatchWords(colour)}
                    className="px-1 pb-2"
                  >
                    <span className="sr-only">{colourName(colour)}</span>
                    <span
                      aria-hidden
                      className={cn('mx-auto block h-2 w-5 rounded-full', SHIFT_TYPE_TONE[colour].dot)}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listed.map((type) => (
                <tr
                  key={type.id}
                  data-type-row={type.id}
                  aria-busy={saving === type.id || undefined}
                  onKeyDown={walkSwatches}
                  className="[&>*]:border-t [&>*]:border-slate-100 dark:[&>*]:border-slate-800"
                >
                  <th
                    scope="row"
                    className="sticky start-0 z-[1] max-w-[11rem] bg-white py-2 pe-3 text-start font-normal dark:bg-[#121c3f]"
                  >
                    {typeCell(type)}
                  </th>
                  {palette.map((colour) => (
                    <td key={colour} className="px-1 py-2 text-center">
                      {swatch(type, colour)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DesignDialog>
  );
};
