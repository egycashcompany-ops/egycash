// Placeholder reference controls for cross-module entities whose real pickers do not exist yet
// (Job Requisition, Branch/Organization). They never expose a raw ID text box: when no value is
// present they render a clearly-disabled "coming soon" selector; when a value is supplied by
// context (e.g. a deep link from the future Requisitions screen) they render a read-only
// reference chip. Shaped to become real async-search selects later without touching call sites.
import { useT } from '../../../../../platform/localization/useT';
import { ChevronIcon, LinkIcon } from '../../../../../shared/ui/icons';

type RefKind = 'requisition' | 'branch';

const shortRef = (id: string): string => (id.length > 8 ? `…${id.slice(-6)}` : id);

/** Compact read-only reference (used in detail views). */
export const ReferenceChip = ({ kind, value }: { kind: RefKind; value: string | null }): JSX.Element => {
  const t = useT();
  if (value === null || value === '') return <span className="text-slate-400">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">
      <LinkIcon className="h-3.5 w-3.5 text-slate-400" />
      <span className="text-slate-600 dark:text-slate-300">{t(`applicants.ref.${kind}`)}</span>
      <span className="font-mono text-slate-400" dir="ltr">{shortRef(value)}</span>
    </span>
  );
};

/** Form control: read-only chip when a value is provided by context, else a disabled placeholder. */
export const ReferenceField = ({
  kind,
  value,
  error,
}: {
  kind: RefKind;
  value?: string | undefined;
  error?: string | undefined;
}): JSX.Element => {
  const t = useT();
  const has = value !== undefined && value !== '';
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
        {t(`applicants.ref.${kind}`)}
      </label>
      {has ? (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/60">
          <LinkIcon className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="font-medium text-slate-700 dark:text-slate-200">{t(`applicants.ref.${kind}`)}</span>
          <span className="font-mono text-xs text-slate-400" dir="ltr">{shortRef(value ?? '')}</span>
          <span className="ms-auto text-xs text-slate-400">{t('applicants.ref.fromContext')}</span>
        </div>
      ) : (
        <div className="relative">
          <div className="flex w-full cursor-not-allowed items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-800/40">
            {t(`applicants.ref.${kind}Pending`)}
          </div>
          <ChevronIcon className="pointer-events-none absolute inset-y-0 end-3 my-auto h-4 w-4 text-slate-300" />
        </div>
      )}
      {error !== undefined && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
};
