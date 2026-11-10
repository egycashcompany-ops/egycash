// One hiring paper as a tile to tick (A28) — «toggle buttoms للنمازج … بشكل منظم جدا». The owner's
// own pattern: a square card, the paper's icon over its name; ticked, the card turns blue and a
// round check appears in its corner. The input is visually hidden but stays the control, so the
// keyboard and screen readers work it as a checkbox. «تعديل» and «طباعة» sit under the card, outside
// the label, so pressing them never ticks it.
import { useT } from '../../../../platform/localization/useT';

const ContractIcon = (): JSX.Element => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <path d="M8 13h8M8 9.5h3" />
    <path d="M8 17.5c1-1.4 2-1.4 3 0s2 1.4 3 0" />
  </svg>
);

const FormIcon = (): JSX.Element => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
  disabled = false,
  onToggle,
  onEdit,
  onPrint,
}: {
  paperKey: string;
  name: string;
  kind: 'contract' | 'form';
  checked: boolean;
  disabled?: boolean;
  onToggle: (checked: boolean) => void;
  onEdit: () => void;
  onPrint: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <div className="flex w-36 flex-col items-stretch gap-1.5" data-paper={paperKey}>
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
            'relative flex min-h-[7rem] w-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-[3px] p-2',
            'border-slate-200 bg-white shadow-lg transition-all duration-200 dark:border-slate-700 dark:bg-slate-800',
            "before:absolute before:start-1 before:top-1 before:flex before:h-5 before:w-5 before:scale-0 before:items-center before:justify-center before:rounded-full before:border-[3px] before:text-xs before:text-white before:opacity-0 before:transition-transform before:content-['']",
            'hover:border-blue-400 hover:before:scale-100 hover:before:opacity-100',
            "peer-checked:border-blue-400 peer-checked:text-blue-500 peer-checked:shadow-blue-400/10 peer-checked:before:scale-100 peer-checked:before:border-blue-400 peer-checked:before:bg-blue-400 peer-checked:before:opacity-100 peer-checked:before:content-['✓']",
            'peer-focus-visible:ring-2 peer-focus-visible:ring-blue-400 peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
          ].join(' ')}
        >
          <span className="transition-all duration-100">{kind === 'contract' ? <ContractIcon /> : <FormIcon />}</span>
          <span className="text-center text-xs font-medium leading-snug transition-all duration-300">{name}</span>
        </span>
      </label>
      <div className="flex items-center justify-center gap-1">
        <button
          type="button"
          onClick={onEdit}
          className="rounded px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
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
    </div>
  );
};
