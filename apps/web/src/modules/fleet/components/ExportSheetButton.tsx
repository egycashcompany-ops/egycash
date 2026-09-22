// The «Excel» button on a Fleet list screen — one control, so eight screens cannot drift apart.
//
// It owns the two things that are the same everywhere and easy to get subtly different: what the
// reader is told while the file is being gathered, and what they are told when it fails. The rows
// are the caller's business, because only the screen knows its own columns.
//
// IT FETCHES. The tables are paged and the file must hold «اللى الفلتر عامله بس» — all of it — so
// pressing this asks the server again with the screen's own filters and walks the pages. That takes
// a moment on a wide filter, which is why the button says so rather than looking broken.
import { useState } from 'react';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { type Locale } from '@ecms/contracts';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';
import { DownloadIcon } from '../../../shared/ui/icons';

export const ExportSheetButton = ({
  onExport,
  disabled = false,
  name,
}: {
  /** Gathers the rows and writes the file. Rejects like any other request; this reports it. */
  onExport: () => Promise<void>;
  disabled?: boolean;
  /** `data-export` — what this button exports, so a test can find the right one on a screen. */
  name: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [busy, setBusy] = useState(false);
  const run = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await onExport();
    } catch (error) {
      // NAMED, not swallowed. A button that silently does nothing is read as broken software, and
      // the reader's next move is to press it again.
      toast.error(errorMessage(error, locale));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      data-export={name}
      aria-label={t('fleet.export.excel')}
      title={t('fleet.export.excel')}
      disabled={disabled || busy}
      onClick={() => void run()}
      className="rounded-md p-1.5 text-emerald-600 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
    >
      <DownloadIcon className="h-6 w-6" />
    </button>
  );
};
