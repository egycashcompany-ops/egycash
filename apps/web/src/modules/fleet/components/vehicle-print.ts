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

export interface VehiclePrintRow {
  label: string;
  value: string;
}

export interface VehiclePrintDocument {
  title: string;
  /** Rendered as the document's identity line under the title. */
  subtitle: string;
  rows: VehiclePrintRow[];
  /**
   * The image section, and HOW TO GET the bytes.
   *
   * The fetch travels with the document rather than being hard-wired to the vehicle registry: a
   * driver's licence prints from the same idiom and the same builder, and the only thing that
   * differs between them is which endpoint holds the file. Everything else — the inlining, the
   * "omit the section rather than print an empty heading" rule, the torn-off window — is the same
   * document, and forking it would have meant two of them drifting apart.
   */
  licenseImage: { heading: string; caption: string; fetch: () => Promise<Blob> } | null;
  locale: Locale;
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
    .map((row) => `<tr><th>${escapeHtml(row.label)}</th><td>${escapeHtml(row.value)}</td></tr>`)
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
  /*
   * ONE PAGE, ALWAYS — «عاوز لما اجى اطبع صوره الرخصه تكون فى صفحه واحده مع الجدول».
   *
   * The scan used to sit under the table with a fixed ceiling (150mm) and a rule not to break
   * inside itself, so whenever the table took the top half of the page the whole section had
   * nowhere to go but page two — with the scan alone on it, small, in a corner. The layout is
   * now a column the height of the printable page: the title and the table take what they need
   * and the image section takes WHAT IS LEFT, shrinking the scan to fit it. The page can no
   * longer overflow, so there is nothing left for a page break to decide.
   *
   * The full-height html/body pair is what makes «what is left» measurable in print: without
   * it the body is as tall as its content and there is no remainder to hand the image. (No
   * backticks in this comment — it lives inside a template literal.)
   */
  html, body { height: 100%; margin: 0; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif; color: #0f172a;
    display: flex; flex-direction: column; box-sizing: border-box;
  }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .subtitle { font-size: 13px; color: #475569; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 10px; text-align: ${rtl ? 'right' : 'left'}; }
  th { width: 34%; background: #f1f5f9; font-weight: 600; }
  .image {
    margin-top: 20px;
    /* The remainder of the page, and never more: min-height 0 lets a flex child shrink
       below its content, which is the whole mechanism. */
    flex: 1 1 auto; min-height: 0;
    display: flex; flex-direction: column;
  }
  .image h2 { font-size: 15px; margin: 0 0 4px; }
  .caption { font-size: 12px; color: #475569; margin: 0 0 8px; }
  .image img {
    /* Fill the rest of the section, keeping the scan's own proportions. No border: the box is
       the whole width and the scan seldom is, so a border drew a frame around blank paper. */
    flex: 1 1 auto; min-height: 0; width: 100%;
    object-fit: contain; object-position: top ${rtl ? 'right' : 'left'};
  }
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
export const printLicenceRecord = async (doc: VehiclePrintDocument): Promise<void> => {
  let imageDataUrl: string | null = null;
  if (doc.licenseImage !== null) {
    // A failed image must not cost the user the printout — the record still prints, without it.
    imageDataUrl = await doc.licenseImage
      .fetch()
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
