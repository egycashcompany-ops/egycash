// Printing the QR label sheet (design §4.2).
//
// The server answers this one endpoint two ways: a PDF when the chromium driver is configured,
// and the identical HTML when it is not — so nothing about label printing depends on a browser
// binary being installed. The two need different handling and the difference is invisible to the
// user either way:
//   • PDF  → save it; the browser's own viewer takes it from there.
//   • HTML → open it in a new window and call print(), which is what the PDF path would have
//            produced anyway.
//
// A popup blocker is the one failure worth naming: `window.open` returning null is not an error
// the API can report, so the caller gets a translated message instead of silence.
import { useState } from 'react';
import { useT } from '../../../platform/localization/useT';
import { toast } from '../../../shared/ui/toast/toast-store';
import { saveBlob } from '../../../shared/lib/api-client';
import * as api from '../api/it-api';

export const useAssetLabels = (): {
  print: (assetIds: readonly string[]) => Promise<void>;
  isPrinting: boolean;
} => {
  const t = useT();
  const [isPrinting, setPrinting] = useState(false);

  const print = async (assetIds: readonly string[]): Promise<void> => {
    if (assetIds.length === 0) return;
    setPrinting(true);
    try {
      const { contentType, blob } = await api.renderAssetLabels(assetIds);
      if (contentType.includes('application/pdf')) {
        saveBlob(blob, 'asset-labels.pdf');
        return;
      }
      const sheet = window.open('', '_blank', 'noopener,noreferrer');
      if (sheet === null) {
        toast.error(t('it.assets.labelsPopupBlocked'));
        return;
      }
      sheet.document.open();
      sheet.document.write(await blob.text());
      sheet.document.close();
      // Let the document lay out before the print dialog measures it.
      sheet.addEventListener('load', () => sheet.print());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setPrinting(false);
    }
  };

  return { print, isPrinting };
};
