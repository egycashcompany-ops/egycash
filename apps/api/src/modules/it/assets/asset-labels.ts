// QR label sheet (design §4.2): the QR payload is the PLAIN assetCode — not a URL, so printed
// labels survive redeployment and re-domaining. The sheet is an A4 grid; the PDF comes from the
// platform chromium driver when configured, and the same HTML is the print-view fallback when it
// is not (the evaluation-batch precedent) — dev and CI need no chromium to be useful.
import QRCode from 'qrcode';

export interface AssetLabel {
  assetCode: string;
  name: string;
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Pure layout: labels + their pre-rendered QR data-URLs → the printable A4 sheet. */
export const buildAssetLabelSheetHtml = (
  labels: readonly (AssetLabel & { qrDataUrl: string })[],
): string => {
  const cells = labels
    .map(
      (label) => `
      <div class="label">
        <img src="${label.qrDataUrl}" alt="" />
        <div class="code">${escapeHtml(label.assetCode)}</div>
        <div class="name">${escapeHtml(label.name)}</div>
      </div>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>Asset labels</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; }
  .sheet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
  .label {
    border: 0.3mm solid #999; border-radius: 2mm; padding: 3mm;
    display: flex; flex-direction: column; align-items: center; text-align: center;
    break-inside: avoid; page-break-inside: avoid;
  }
  .label img { width: 28mm; height: 28mm; }
  .code { font-size: 11pt; font-weight: 700; letter-spacing: 0.5pt; margin-top: 1.5mm; }
  .name { font-size: 8pt; color: #333; margin-top: 0.5mm; overflow-wrap: anywhere; }
</style>
</head>
<body><div class="sheet">
${cells}
</div></body>
</html>`;
};

/** QR per label — error-correction M and a quiet zone wide enough for battered printers. */
export const renderLabelQrs = async (
  labels: readonly AssetLabel[],
): Promise<(AssetLabel & { qrDataUrl: string })[]> =>
  Promise.all(
    labels.map(async (label) => ({
      ...label,
      qrDataUrl: await QRCode.toDataURL(label.assetCode, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 220,
      }),
    })),
  );
