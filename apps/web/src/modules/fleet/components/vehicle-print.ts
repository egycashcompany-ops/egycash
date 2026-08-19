// Printing a vehicle's registry record (§9).
//
// Built on the module's existing print idiom (`contract-doc-actions.ts`): compose a document,
// open it in a window, print it. Nothing is fetched that the caller does not already hold except
// the license image, which arrives as bytes and is inlined as a data URL — a blob or object URL
// would be revoked, and a same-origin `<img src>` in a torn-off window is not reliably loaded
// before the print dialog measures the page.
//
// The image section renders ONLY when there is an image (§9): an empty "license image" heading
// over blank paper is worse than no section, so absent means absent.
import { type Locale } from '@ecms/contracts';
import { fetchVehicleLicenseImage } from '../api/fleet-api';

export interface VehiclePrintRow {
  label: string;
  value: string;
}

export interface VehiclePrintDocument {
  title: string;
  /** Rendered as the document's identity line under the title. */
  subtitle: string;
  rows: VehiclePrintRow[];
  licenseImage: { heading: string; caption: string; vehicleId: string } | null;
  locale: Locale;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const blobToDataUrl = async (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('could not read the license image'));
    reader.readAsDataURL(blob);
  });

/** The printable HTML. Exported for testing — composing it is where the §9 rules actually live. */
export const buildVehiclePrintHtml = (
  doc: VehiclePrintDocument,
  imageDataUrl: string | null,
): string => {
  const rtl = doc.locale === 'ar';
  const rows = doc.rows
    .map(
      (row) =>
        `<tr><th>${escapeHtml(row.label)}</th><td>${escapeHtml(row.value)}</td></tr>`,
    )
    .join('');
  // Both conditions matter: no image on the vehicle, or bytes that failed to load, and either way
  // the section is omitted rather than printed empty.
  const imageSection =
    doc.licenseImage === null || imageDataUrl === null
      ? ''
      : `<section class="image">
          <h2>${escapeHtml(doc.licenseImage.heading)}</h2>
          <p class="caption">${escapeHtml(doc.licenseImage.caption)}</p>
          <img src="${imageDataUrl}" alt="${escapeHtml(doc.licenseImage.heading)}" />
        </section>`;

  return `<!doctype html>
<html lang="${rtl ? 'ar' : 'en'}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(doc.title)}</title>
<style>
  @page { margin: 16mm; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif; color: #0f172a; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .subtitle { font-size: 13px; color: #475569; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 10px; text-align: ${rtl ? 'right' : 'left'}; }
  th { width: 34%; background: #f1f5f9; font-weight: 600; }
  .image { margin-top: 20px; page-break-inside: avoid; }
  .image h2 { font-size: 15px; margin: 0 0 4px; }
  .caption { font-size: 12px; color: #475569; margin: 0 0 8px; }
  .image img { max-width: 100%; max-height: 150mm; border: 1px solid #cbd5e1; }
</style>
</head>
<body>
  <h1>${escapeHtml(doc.title)}</h1>
  <p class="subtitle">${escapeHtml(doc.subtitle)}</p>
  <table><tbody>${rows}</tbody></table>
  ${imageSection}
</body>
</html>`;
};

/** Compose the document, resolve the image if there is one, and hand it to the print dialog. */
export const printVehicle = async (doc: VehiclePrintDocument): Promise<void> => {
  let imageDataUrl: string | null = null;
  if (doc.licenseImage !== null) {
    // A failed image must not cost the user the printout — the record still prints, without it.
    imageDataUrl = await fetchVehicleLicenseImage(doc.licenseImage.vehicleId)
      .then(blobToDataUrl)
      .catch(() => null);
  }
  const win = window.open('', '_blank');
  if (win === null) throw new Error('popup blocked');
  win.document.open();
  win.document.write(buildVehiclePrintHtml(doc, imageDataUrl));
  win.document.close();
  win.focus();
  // Let the inlined image decode and the table lay out before the dialog measures the page.
  win.setTimeout(() => win.print(), 350);
};
