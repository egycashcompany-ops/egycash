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
`;

export interface RenderOptions {
  /** A14 — printed as the integrity footer line once generation freezes it. */
  integrityLine?: string | undefined;
  /** Absolute/relative URL for the logo image, when the template carries one. */
  logoUrl?: string | undefined;
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

  return `<!doctype html>
<html lang="${template.language}" dir="${dir}">
<head><meta charset="utf-8" /><style>${PRINT_CSS}</style></head>
<body>
  <div class="page">
    <header>${logo}${substitute(template.sections.header, values)}</header>
    <main>${substitute(template.sections.body, values)}</main>
    <div class="signatures">${signatures}</div>
    <footer>${substitute(template.sections.footer, values)}${integrity}</footer>
  </div>
</body>
</html>`;
};
