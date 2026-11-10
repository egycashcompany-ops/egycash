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

/** The branding profile's CSS, under `scope` so a printed set can keep it on the contract's pages. */
const brandCssFor = (branding: RenderOptions['branding'], scope = ''): string =>
  branding === undefined
    ? ''
    : `
  ${scope} h1, ${scope} h2, ${scope} h3, ${scope} h4 { color: ${branding.primaryColor}; }
  ${scope} header, ${scope} footer { border-color: ${branding.primaryColor}; }
  .brand-header { display: flex; align-items: center; gap: 5mm; border-bottom: 2px solid ${branding.primaryColor};
                  padding-bottom: 3mm; margin-bottom: 5mm; }
  .brand-header img { max-height: 18mm; }
  .brand-header .line { font-size: 10pt; font-weight: 600; color: ${branding.primaryColor}; }
  .brand-footer { margin-top: 3mm; font-size: 8.5pt; color: ${branding.primaryColor}; text-align: center; }
  .watermark { position: fixed; inset: 0; display: grid; place-items: center; z-index: -1;
               transform: rotate(-35deg); font-size: 46pt; font-weight: 700;
               color: ${branding.primaryColor}; opacity: 0.07; pointer-events: none; }`;

/** The contract's page content — everything inside `<body>` — shared by the document and the set. */
const contractBody = (
  template: Pick<ContractTemplateDoc, 'sections' | 'signatures' | 'language'>,
  values: ContractVariableValue[],
  options: RenderOptions,
): string => {
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

  return `
  ${watermark}
  <div class="page">
    ${brandHeader}
    <header>${logo}${substitute(template.sections.header, values)}</header>
    <main>${substitute(template.sections.body, values)}</main>
    <div class="signatures">${signatures}</div>
    <footer>${substitute(template.sections.footer, values)}${brandFooter}${integrity}</footer>
  </div>`;
};

export const renderContractHtml = (
  template: Pick<ContractTemplateDoc, 'sections' | 'signatures' | 'language'>,
  values: ContractVariableValue[],
  options: RenderOptions = {},
): string => {
  const dir = template.language === 'ar' ? 'rtl' : 'ltr';
  return `<!doctype html>
<html lang="${template.language}" dir="${dir}">
<head><meta charset="utf-8" /><style>${PRINT_CSS}${brandCssFor(options.branding)}</style></head>
<body>
${contractBody(template, values, options)}
</body>
</html>`;
};

// ── A27 — the hiring forms and the printed set («مستندات التعيين») ───────────

/**
 * What a form prints where the record holds nothing: a dotted line to write on by hand — the way
 * the company's own forms leave room — never an empty gap nobody notices.
 */
const BLANK = '<span class="blank">&nbsp;</span>';

/** The company letterhead every hiring form wears: the name lines at the start, the logo opposite. */
export interface Letterhead {
  logoDataUri: string;
  lines: readonly string[];
}

/**
 * A form's CSS. The page frame is a one-column TABLE whose header and footer rows carry the top and
 * bottom edges: a printing browser repeats a table's header and footer on every page it runs over,
 * so a form that spills onto a second page is framed — closed top and bottom — on both, and a frame
 * never lands on the contract's pages printed beside it. (`box-decoration-break: clone` was tried
 * first; Chromium left the bottom edge of the first page open.) The BODY CELL is a page tall, so a
 * one-page form is framed down to the foot of the page, as the company's papers are — on the cell,
 * not the table: a table with a height of its own stops repeating its footer.
 */
const FORM_CSS = `
  table.form-frame { width: 100%; border-collapse: collapse; }
  table.form-frame > thead > tr > td, table.form-frame > tfoot > tr > td,
  table.form-frame > tbody > tr > td.form-doc { border: 0; border-left: 1.5px solid #111;
    border-right: 1.5px solid #111; padding: 0; }
  table.form-frame > thead > tr > td { border-top: 1.5px solid #111; height: 6mm; }
  table.form-frame > tfoot > tr > td { border-bottom: 1.5px solid #111; height: 6mm; }
  table.form-frame > tbody > tr > td.form-doc { padding: 2mm 9mm; vertical-align: top; height: 235mm; }
  .form-doc .letterhead { display: flex; justify-content: space-between; align-items: flex-start;
                          margin-bottom: 6mm; }
  .form-doc .letterhead .lines { font-weight: 700; line-height: 1.5; text-align: center; }
  .form-doc .letterhead img { max-height: 15mm; }
  .form-doc .blank { display: inline-block; min-width: 45mm; border-bottom: 1px dotted #444; }
  .form-doc .signatures { margin-top: 12mm; }
`;

const formBody = (
  template: Pick<ContractTemplateDoc, 'sections' | 'signatures' | 'language'>,
  values: ContractVariableValue[],
  letterhead: Letterhead,
): string => {
  const fill = (html: string): string => {
    const map = new Map(values.map((v) => [v.key, v.value]));
    return html.replace(/\{\{\s*([a-zA-Z0-9.]+)\s*\}\}/g, (_m, key: string) => {
      const value = map.get(key) ?? '';
      return value.trim() === '' ? BLANK : value;
    });
  };
  const signatures = template.signatures
    .map(
      (block) => `
        <div class="signature">
          <div>${block.label}</div>
          ${block.name === undefined || block.name === '' ? '' : `<div>${block.name}</div>`}
          <div class="line">&nbsp;</div>
        </div>`,
    )
    .join('\n');
  return `
  <table class="form-frame">
    <thead><tr><td></td></tr></thead>
    <tfoot><tr><td></td></tr></tfoot>
    <tbody><tr><td class="form-doc">
      <div class="letterhead">
        <div class="lines">${letterhead.lines.join('<br />')}</div>
        <img src="${letterhead.logoDataUri}" alt="" />
      </div>
      ${fill(template.sections.header)}
      <main>${fill(template.sections.body)}</main>
      ${signatures === '' ? '' : `<div class="signatures">${signatures}</div>`}
      ${fill(template.sections.footer)}
    </td></tr></tbody>
  </table>`;
};

/** One hiring form, alone — what the template editor previews. */
export const renderFormHtml = (
  template: Pick<ContractTemplateDoc, 'sections' | 'signatures' | 'language'>,
  values: ContractVariableValue[],
  letterhead: Letterhead,
): string => {
  const dir = template.language === 'ar' ? 'rtl' : 'ltr';
  return `<!doctype html>
<html lang="${template.language}" dir="${dir}">
<head><meta charset="utf-8" /><style>${PRINT_CSS}${FORM_CSS}</style></head>
<body>
${formBody(template, values, letterhead)}
</body>
</html>`;
};

/** One document of the printed set: the contract (as generated) or a form for the employee's job. */
export type HiringPackPart =
  | {
      kind: 'contract';
      template: Pick<ContractTemplateDoc, 'sections' | 'signatures' | 'language'>;
      values: ContractVariableValue[];
      options: RenderOptions;
    }
  | {
      kind: 'form';
      template: Pick<ContractTemplateDoc, 'sections' | 'signatures' | 'language'>;
      values: ContractVariableValue[];
    };

/**
 * Everything one employee signs on joining, as ONE document: each part starts on a fresh page, so
 * a single print gives the whole set in order. The contract keeps its branding inside its own
 * section; the forms wear the letterhead.
 */
export const renderHiringPackHtml = (
  parts: readonly HiringPackPart[],
  language: 'ar' | 'en',
  letterhead: Letterhead,
): string => {
  const dir = language === 'ar' ? 'rtl' : 'ltr';
  const contract = parts.find((part) => part.kind === 'contract');
  const brandCss = contract?.kind === 'contract' ? brandCssFor(contract.options.branding, '.doc-contract') : '';
  const sections = parts
    .map((part, index) => {
      const pageBreak = index === 0 ? '' : ' style="break-before: page;"';
      return part.kind === 'contract'
        ? `<section class="doc doc-contract"${pageBreak}>${contractBody(part.template, part.values, part.options)}</section>`
        : `<section class="doc doc-form"${pageBreak}>${formBody(part.template, part.values, letterhead)}</section>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="${language}" dir="${dir}">
<head><meta charset="utf-8" /><style>${PRINT_CSS}${brandCss}${FORM_CSS}</style></head>
<body>
${sections}
</body>
</html>`;
};
