// The two document actions a Fleet list offers — print and Excel — as icons in the page header,
// beside the screen's own button, ABOVE the filters. «عاوز يكونوا عند الفلاتر بس فوق زى شاشه
// السيارات والسواقيين والمخالفات»: the vehicles and drivers screens put their Excel button in the
// header's action slot, and this puts both actions there on the newer screens.
import { useT } from '../../../platform/localization/useT';
import { PrinterIcon } from '../../../shared/ui/icons';
import { ExportSheetButton } from './ExportSheetButton';

export const DocumentActions = ({
  name,
  onPrint,
  onExport,
}: {
  /** `data-print` / `data-export` — which screen's documents these are, for a test to find. */
  name: string;
  onPrint: () => Promise<void> | void;
  onExport: () => Promise<void>;
}): JSX.Element => {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        data-print={name}
        aria-label={t('common.print')}
        title={t('common.print')}
        onClick={() => void onPrint()}
        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <PrinterIcon className="h-6 w-6" />
      </button>
      <ExportSheetButton name={name} onExport={onExport} />
    </span>
  );
};
