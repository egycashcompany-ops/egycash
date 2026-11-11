// One hiring paper as a tile to tick (A28) — «toggle buttoms للنمازج … بشكل منظم جدا». The owner's
// own pattern: a square card, the paper's icon over its name; ticked, the card turns blue and a
// round check appears in its corner. The input is visually hidden but stays the control, so the
// keyboard and screen readers work it as a checkbox. «تعديل» and «طباعة» sit under the card, outside
// the label, so pressing them never ticks it. Compact: every paper fits one row beside the title.
import { useT } from '../../../../platform/localization/useT';

const ContractIcon = (): JSX.Element => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <path d="M8 13h8M8 9.5h3" />
    <path d="M8 17.5c1-1.4 2-1.4 3 0s2 1.4 3 0" />
  </svg>
);

const FormIcon = (): JSX.Element => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <path d="M8 12h8M8 15.5h8M8 8.5h3" />
  </svg>
);

export const PaperTile = ({
  paperKey,
  name,
  kind,
  checked,
  active = false,
  disabled = false,
  onToggle,
  onEdit,
  onPrint,
  caption,
}: {
  paperKey: string;
  name: string;
  kind: 'contract' | 'form';
  checked: boolean;
  /** The paper open in the form below — marked under its card. */
  active?: boolean;
  disabled?: boolean;
  onToggle: (checked: boolean) => void;
  /** «تعديل» and «طباعة» under the card — left out where there is nothing to open or print alone. */
  onEdit?: () => void;
  onPrint?: () => void;
  /** A line under the card instead — «لـ ٣ أشخاص» in the printing for many. */
  caption?: string;
}): JSX.Element => {
  const t = useT();
  return (
    <div className="flex w-28 shrink-0 flex-col items-stretch gap-1" data-paper={paperKey} data-active={active || undefined}>
      <label className="text-slate-500 dark:text-slate-400">
        <input
          type="checkbox"
          className="peer absolute h-px w-px overflow-hidden whitespace-nowrap opacity-0"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span
          className={[
            'relative flex min-h-[6.5rem] w-28 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-[3px] p-1.5',
            'border-slate-200 bg-white shadow-lg transition-all duration-200 dark:border-slate-700 dark:bg-slate-800',
            "before:absolute before:start-1 before:top-1 before:flex before:h-5 before:w-5 before:scale-0 before:items-center before:justify-center before:rounded-full before:border-[3px] before:text-xs before:text-white before:opacity-0 before:transition-transform before:content-['']",
            'hover:border-blue-400 hover:before:scale-100 hover:before:opacity-100',
            "peer-checked:border-blue-400 peer-checked:text-blue-500 peer-checked:shadow-blue-400/10 peer-checked:before:scale-100 peer-checked:before:border-blue-400 peer-checked:before:bg-blue-400 peer-checked:before:opacity-100 peer-checked:before:content-['✓']",
            'peer-focus-visible:ring-2 peer-focus-visible:ring-blue-400 peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
          ].join(' ')}
        >
          <span className="transition-all duration-100">{kind === 'contract' ? <ContractIcon /> : <FormIcon />}</span>
          <span className="text-center text-[11px] font-medium leading-snug transition-all duration-300">{name}</span>
        </span>
      </label>
      {caption !== undefined && <p className="text-center text-[11px] text-slate-500 dark:text-slate-400">{caption}</p>}
      {onEdit !== undefined && onPrint !== undefined && (
        <div className="flex items-center justify-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            aria-pressed={active}
            className={[
              'rounded px-2 py-0.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-800',
              active
                ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-slate-800 dark:text-blue-300'
                : 'text-slate-600 dark:text-slate-300',
            ].join(' ')}
          >
            {t('contracts.candidate.edit')}
          </button>
          <span className="text-slate-300 dark:text-slate-600">|</span>
          <button
            type="button"
            onClick={onPrint}
            className="rounded px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-slate-800"
          >
            {t('contracts.candidate.printOne')}
          </button>
        </div>
      )}
    </div>
  );
};
