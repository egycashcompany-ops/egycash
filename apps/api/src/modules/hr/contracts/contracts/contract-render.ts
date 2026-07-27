// The ONE document renderer (frozen design D6/A18): preview, snapshot and the PDF job all
// consume this exact output — an A4 print-ready HTML page with the template's sections,
// logo, signature blocks and the resolved variables substituted via the platform's pure
// template engine. Deterministic by construction (A21): fixed page box, fixed font stack.
import { type ContractTemplateDoc } from '../contract-templates/contract-template.model';
import { type ContractVariableValue } from './contract.model';

const PRINT_CSS = `
  @page { size: A4; margin: 20mm 18mm; }
  html { -webkit-print-color-adjust: exact; }
  body { font-family: 'Noto Naskh Arabic', 'Noto Sans', 'Times New Roman', serif;
         font-size: 12pt; line-height: 1.8; color: #111; margin: 0; }
  .page { max-width: 174mm; margin: 0 auto; }
  header { border-bottom: 1px solid #555; padding-bottom: 4mm; margin-bottom: 8mm; }
  header img.logo { max-height: 22mm; }
  footer { border-top: 1px solid #555; padding-top: 3mm; margin-top: 10mm; font-size: 9pt; color: #444; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #777; padding: 2mm 3mm; }
  .signatures { display: flex; flex-wrap: wrap; gap: 10mm; margin-top: 16mm; }
  .signature { min-width: 45mm; text-align: center; }
  .signature .line { border-top: 1px solid #111; margin-top: 14mm; padding-top: 2mm; }
  .integrity { font-size: 7.5pt; color: #666; margin-top: 6mm; direction: ltr; text-align: left; }
  .integrity img.qr { width: 20mm; height: 20mm; float: right; margin-left: 4mm; }
`;

export interface RenderOptions {
  /** A14 — printed as the integrity footer line once generation freezes it. */
  integrityLine?: string | undefined;
  /** Absolute/relative URL for the logo image, when the template carries one. */
  logoUrl?: string | undefined;
  /** A24 — the company branding profile, frozen into the snapshot at render. */
  branding?:
    | {
        logoDataUri: string | null;
        headerText: string;
        footerText: string;
        watermark: string;
        primaryColor: string;
      }
    | undefined;
}

/** Substitute {{key}} → value across a section (missing keys render as empty). */
const substitute = (html: string, values: ContractVariableValue[]): string => {
  const map = new Map(values.map((v) => [v.key, v.value]));
  return html.replace(/\{\{\s*([a-zA-Z0-9.]+)\s*\}\}/g, (_m, key: string) => map.get(key) ?? '');
};

export const renderContractHtml = (
  template: Pick<ContractTemplateDoc, 'sections' | 'signatures' | 'language'>,
  values: ContractVariableValue[],
  options: RenderOptions = {},
): string => {
  const dir = template.language === 'ar' ? 'rtl' : 'ltr';
  const signatures = template.signatures
    .map(
      (block) => `
        <div class="signature">
          <div>${block.label}</div>
          ${block.name === undefined || block.name === '' ? '' : `<div>${block.name}</div>`}
          ${block.title === undefined || block.title === '' ? '' : `<div>${block.title}</div>`}
          <div class="line">&nbsp;</div>
        </div>`,
    )
    .join('\n');
  const logo =
    options.logoUrl === undefined ? '' : `<img class="logo" src="${options.logoUrl}" alt="" />`;
  const integrity =
    options.integrityLine === undefined ? '' : `<div class="integrity">${options.integrityLine}</div>`;

  // A24 — the branding profile wraps the template's own sections; every piece is
  // optional and the whole block is frozen into the snapshot.
  const branding = options.branding;
  const brandCss =
    branding === undefined
      ? ''
      : `
  h1, h2, h3, h4 { color: ${branding.primaryColor}; }
  header, footer { border-color: ${branding.primaryColor}; }
  .brand-header { display: flex; align-items: center; gap: 5mm; border-bottom: 2px solid ${branding.primaryColor};
                  padding-bottom: 3mm; margin-bottom: 5mm; }
  .brand-header img { max-height: 18mm; }
  .brand-header .line { font-size: 10pt; font-weight: 600; color: ${branding.primaryColor}; }
  .brand-footer { margin-top: 3mm; font-size: 8.5pt; color: ${branding.primaryColor}; text-align: center; }
  .watermark { position: fixed; inset: 0; display: grid; place-items: center; z-index: -1;
               transform: rotate(-35deg); font-size: 46pt; font-weight: 700;
               color: ${branding.primaryColor}; opacity: 0.07; pointer-events: none; }`;
  const watermark =
    branding === undefined || branding.watermark === ''
      ? ''
      : `<div class="watermark">${branding.watermark}</div>`;
  const brandHeader =
    branding === undefined || (branding.logoDataUri === null && branding.headerText === '')
      ? ''
      : `<div class="brand-header">${
          branding.logoDataUri === null ? '' : `<img src="${branding.logoDataUri}" alt="" />`
        }${branding.headerText === '' ? '' : `<span class="line">${branding.headerText}</span>`}</div>`;
  const brandFooter =
    branding === undefined || branding.footerText === ''
      ? ''
      : `<div class="brand-footer">${branding.footerText}</div>`;

  return `<!doctype html>
<html lang="${template.language}" dir="${dir}">
<head><meta charset="utf-8" /><style>${PRINT_CSS}${brandCss}</style></head>
<body>
  ${watermark}
  <div class="page">
    ${brandHeader}
    <header>${logo}${substitute(template.sections.header, values)}</header>
    <main>${substitute(template.sections.body, values)}</main>
    <div class="signatures">${signatures}</div>
    <footer>${substitute(template.sections.footer, values)}${brandFooter}${integrity}</footer>
  </div>
</body>
</html>`;
};
