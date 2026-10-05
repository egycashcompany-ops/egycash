// Printing the QR label sheet (design §4.2).
//
// The server answers this one endpoint two ways: a PDF when the chromium driver is configured,
// and the identical HTML when it is not — so nothing about label printing depends on a browser
// binary being installed. The two need different handling and the difference is invisible to the
// user either way:
//   • PDF  → save it; the browser's own viewer takes it from there.
//   • HTML → print it from its own tab, which is what the PDF path would have produced anyway.
//
// The tab is opened FIRST, inside the click, and filled once the sheet arrives: a tab opened after
// the round trip is one a popup blocker refuses. It used to be opened afterwards and with
// `noopener` — and `window.open` with `noopener` returns null by definition, so the HTML sheet
// never printed: every attempt read as a blocked popup. The dialog itself is opened from the app's
// script, because the tab inherits the app's Content-Security-Policy and would never run one of
// its own (`shared/lib/print-window.ts`).
//
// A popup blocker is the one failure worth naming: `window.open` returning null is not an error
// the API can report, so the caller gets a translated message instead of silence.
import { useState } from 'react';
import { useT } from '../../../platform/localization/useT';
import { toast } from '../../../shared/ui/toast/toast-store';
import { saveBlob } from '../../../shared/lib/api-client';
import { openPrintWindow, writePrintWindow } from '../../../shared/lib/print-window';
import * as api from '../api/it-api';

export const useAssetLabels = (): {
  print: (assetIds: readonly string[]) => Promise<void>;
  isPrinting: boolean;
} => {
  const t = useT();
  const [isPrinting, setPrinting] = useState(false);

  const print = async (assetIds: readonly string[]): Promise<void> => {
    if (assetIds.length === 0) return;
    const sheet = openPrintWindow(t('common.loading'));
    if (sheet === null) {
      toast.error(t('it.assets.labelsPopupBlocked'));
      return;
    }
    setPrinting(true);
    try {
      const { contentType, blob } = await api.renderAssetLabels(assetIds);
      if (contentType.includes('application/pdf')) {
        sheet.close();
        saveBlob(blob, 'asset-labels.pdf');
        return;
      }
      writePrintWindow(sheet, await blob.text());
    } catch (error) {
      sheet.close();
      toast.error(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setPrinting(false);
    }
  };

  return { print, isPrinting };
};
