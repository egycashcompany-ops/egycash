// The ONE document renderer (frozen design D6/A18): preview, snapshot and the PDF job all
// consume this exact output — an A4 print-ready HTML page with the template's sections,
// logo, signature blocks and the resolved variables substituted via the platform's pure
// template engine. Deterministic by construction (A21): fixed page box, fixed font stack.
import { type ContractTemplateDoc } from '../contract-templates/contract-template.model';
import { BASMALA_PNG } from './basmala';
import { NOSI_EMBLEM_JPG } from './nosi-emblem';
import { type ContractVariableValue } from './contract.model';

/**
 * The owner's papers as his Word files print them (A27, «رجعهم كلهم زي الاصل») — the classes
 * `PAPER_CLASSES` allows, under `scope`: a form, or a contract's page.
 */
const paperCss = (scope: string): string => `
  ${scope} .t10 { font-size: 10pt; }
  ${scope} .t12 { font-size: 12pt; }
  ${scope} .t14 { font-size: 14pt; }
  ${scope} .t16 { font-size: 16pt; }
  ${scope} .t20 { font-size: 20pt; }
  ${scope} .l1 { line-height: 1.35; margin-top: 0; margin-bottom: 1.5mm; }
  ${scope} .l15 { line-height: 1.5; }
  ${scope} .l2 { line-height: 2; }
  ${scope} .l3 { line-height: 3; }
  ${scope} p.rule { border-bottom: 1.5px solid #111; }
  /* His clauses' star. */
  ${scope} ul.star { list-style-type: "☆  "; }
  /* Label and dotted-line rows: no borders; a label keeps its width, a \`dots\` cell (and the last
     cell of a row without one) takes the rest. */
  ${scope} table.plain { width: 100%; border: none; }
  ${scope} table.plain td, ${scope} table.plain th { border: none; padding: 0 1mm; width: 1%; white-space: nowrap;
                                                     vertical-align: bottom; text-align: start; font-weight: inherit; }
  ${scope} table.plain td.dots, ${scope} table.plain tr:not(:has(td.dots)) td:last-child { width: auto; }
  ${scope} table.plain td.dots { border-bottom: 1.2px dotted #222; }
  /* \`cols\`: columns of equal width whose text wraps — his card's job, manager and department. */
  ${scope} table.plain.cols { table-layout: fixed; }
  ${scope} table.plain.cols td { width: auto; white-space: normal; }
  /* A row's spacing goes above it, so the dotted line stays on the label's own line. */
  ${scope} table.plain.l2 td, ${scope} table.plain.l3 td { line-height: 1.5; }
  ${scope} table.plain.l2 { margin-top: 3mm; }
  ${scope} table.plain.l3 { margin-top: 8mm; }
  /* The shaded heading box. */
  ${scope} table.band { width: auto; margin: 3mm auto; }
  ${scope} table.band td { background: #bfbfbf; border: 1px solid #111; padding: 0.5mm 10mm; font-weight: 700;
                           text-align: center; }
  /* The document-control line at the foot of the page. */
  ${scope} table.foot { width: 100%; border: none; margin: 0; font-size: 9pt; direction: ltr; }
  ${scope} table.foot td { border: none; padding: 0; text-align: center; }
  /* «نموذج رقم (1)»: a row of digit boxes, one character each, written left to right (\`boxCells\`). */
  ${scope} .cells { display: inline-flex; vertical-align: middle; direction: ltr; unicode-bidi: isolate;
                    border: 1px solid #111; height: 6.5mm; font-weight: 700; }
  ${scope} .cells > i { font-style: normal; box-sizing: border-box; width: 5.5mm; height: 100%; display: flex;
                        align-items: center; justify-content: center; border-left: 1px solid #111; }
  ${scope} .cells > i:first-child { border-left: none; }
  /* A small boxed table inside a line (the wage boxes, «نوع المدة»). */
  ${scope} table.mini { width: auto; display: inline-table; vertical-align: middle; margin: 0; }
  ${scope} table.mini td { border: 1px solid #111; padding: 0 1mm; height: 5.5mm; min-width: 3.5mm; text-align: center;
                           font-size: 9.5pt; line-height: 1.2; font-weight: 700; }
  /* A section's name in a rounded box on a line across the page. */
  ${scope} p.divider { display: flex; align-items: center; margin: 2mm 0; }
  ${scope} p.divider::before, ${scope} p.divider::after { content: ''; flex: 1; border-top: 2px solid #111; }
  ${scope} p.divider > span { border: 1.5px solid #111; border-radius: 3mm; padding: 0.5mm 9mm; font-weight: 700; }
  /* The next page of the same paper. */
  ${scope} p.newpage { break-before: page; height: 0; margin: 0; overflow: hidden; }
`;

/**
 * The pictures a paper shows by a class, the words staying underneath, unseen: his contract's
 * «بسم الله الرحمن الرحيم» calligraphy (`basmala`) and the emblem heading «نموذج رقم (1)» (`nosi`).
 * Only in a document that uses one — the pictures are not small.
 */
const pictureCss = (html: string): string =>
  (html.includes('class="basmala"')
    ? `.page p.basmala, .form-doc p.basmala { height: 11mm; margin: 0 0 2mm; color: transparent; overflow: hidden;
                       background: url(${BASMALA_PNG}) center / contain no-repeat; }`
    : '') +
  (html.includes('class="nosi"')
    ? `.page p.nosi, .form-doc p.nosi { height: 20mm; margin: 0 auto; color: transparent; overflow: hidden;
                       background: url(${NOSI_EMBLEM_JPG}) center / contain no-repeat; }`
    : '');

/** A doc-control line in a template's footer (`table.foot`), cell by cell as text — or null. */
export const pageFootCells = (footerHtml: string): string[] | null => {
  const table = /<table class="foot">([\s\S]*?)<\/table>/.exec(footerHtml);
  if (table === null) return null;
  const cells = [...(table[1] ?? '').matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
    .map((cell) => (cell[1] ?? '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((text) => text !== '');
  return cells.length === 0 ? null : cells;
};

/** Text as a CSS string — quotes, backslashes and `<` escaped, so it can never close the style. */
const cssString = (text: string): string =>
  `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/</g, '\\3c ').replace(/[\r\n]+/g, ' ')}"`;

/**
 * A contract whose footer is his doc-control line prints it at the foot of EVERY page, as his Word
 * file does — the page's own margin box — and, when `numbered`, the page number at the top from
 * the second page («- 2 -»). A printed set numbers only when it holds one contract: page numbers run
 * through the whole document. On screen (no pages) the line shows under the text instead.
 */
const pageFootCss = (footerHtml: string, numbered: boolean): string => {
  const cells = pageFootCells(footerHtml);
  if (cells === null) return '';
  return `
  @page { @bottom-center { content: ${cssString(cells.join('          '))}; white-space: pre; font-size: 9pt; color: #222; }
          ${numbered ? '@top-center { content: "- " counter(page) " -"; font-size: 12pt; }' : ''} }
  ${numbered ? '@page :first { @top-center { content: none; } }' : ''}
  @media print { .page-foot { display: none; } }`;
};

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
  header:empty, footer:empty { display: none; }
${paperCss('.page')}`;

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
    <footer>${
      pageFootCells(template.sections.footer) === null
        ? substitute(template.sections.footer, values)
        : `<div class="page-foot">${substitute(template.sections.footer, values)}</div>`
    }${brandFooter}${integrity}</footer>
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
<head><meta charset="utf-8" /><style>${PRINT_CSS}${brandCssFor(options.branding)}${pictureCss(template.sections.header + template.sections.body)}${pageFootCss(template.sections.footer, true)}</style></head>
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
 * A form's CSS. The frame is the PAGE's own border: every form is laid out on the named page
 * `form`, and that page box carries the border — so every page a form runs over is framed, closed
 * top and bottom, as the company's papers are, and the contract's pages beside it (on the default
 * page) carry none. Two earlier frames failed in print: `box-decoration-break: clone` left the
 * first page open at the bottom, and a one-column table repeating its header and footer rows did
 * the same whenever the text ran close to the foot of the page. A screen has no pages, so there
 * (the template editor's preview) the form is boxed instead.
 */
const FORM_CSS = `
  @page form { margin: 12mm; border: 1.5px solid #111; padding: 6mm; }
  .doc-form { page: form; }
  /* A form with its own head prints on the bare page: the authority's layout, no frame. */
  @page bare { margin: 9mm 11mm; @top-center { content: none; } @bottom-center { content: none; } }
  .doc-form.doc-bare { page: bare; }
  /* The authority's form is dense: his two Legal pages on A4. */
  .doc-bare .form-doc { font-size: 10.5pt; line-height: 1.3; min-height: 0; }
  .doc-bare .form-doc p { margin: 0 0 1.1mm; }
  .doc-bare .form-doc table { margin-bottom: 1.1mm; }
  .doc-bare .form-doc table.plain td { padding-top: 0.4mm; padding-bottom: 0.4mm; }
  .doc-bare .form-doc p.divider { margin: 1.2mm 0; }
  .doc-bare .form-doc .cells { height: 6mm; }
  .doc-bare .form-doc td, .doc-bare .form-doc th { padding: 0.6mm 2mm; }
  @media screen {
    .form-doc { max-width: 174mm; margin: 0 auto 8mm; padding: 6mm; border: 1.5px solid #111; }
    .doc-bare .form-doc { max-width: 188mm; border: none; }
  }
  .form-doc { font-size: 12pt; line-height: 1.5; display: flex; flex-direction: column; min-height: 254mm; }
  .form-doc .form-foot { margin-top: auto; padding-top: 4mm; }
  .form-doc .letterhead { display: flex; justify-content: space-between; align-items: flex-start;
                          margin-bottom: 4mm; }
  .form-doc .letterhead .lines { font-weight: 700; line-height: 1.5; text-align: center; }
  .form-doc .letterhead img { max-height: 15mm; }
  .form-doc .blank { display: inline-block; min-width: 45mm; border-bottom: 1px dotted #444; }
  .form-doc .signatures { margin-top: 8mm; }
  .form-doc .signature .line { margin-top: 10mm; }
  .form-doc h3 { margin: 0 0 4mm; }
  .form-doc p { margin: 0 0 2.5mm; }
  .form-doc ul, .form-doc ol { margin: 0 0 2.5mm; }
  .form-doc td, .form-doc th { padding: 1mm 2.5mm; }
  .form-doc table { margin-bottom: 2.5mm; }
  /* A contract's page foot and number (\`pageFootCss\`) are not the forms'. */
  @page form { @top-center { content: none; } @bottom-center { content: none; } }
${paperCss('.form-doc')}`;

/** A form that brings its own head (class `ownhead`): no letterhead, and no frame round its pages. */
const ownHead = (template: Pick<ContractTemplateDoc, 'sections'>): boolean =>
  /class="[^"]*\bownhead\b/.test(template.sections.header);

/** A form's section: framed on the `form` page, or on the bare page when it brings its own head. */
const formSection = (
  template: Pick<ContractTemplateDoc, 'sections' | 'signatures' | 'language'>,
  html: string,
  pageBreak = '',
): string => `<section class="doc doc-form${ownHead(template) ? ' doc-bare' : ''}"${pageBreak}>${html}</section>`;

/** Text safe inside HTML. */
const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A row of digit boxes (`<span class="cells cN">…</span>`, «نموذج رقم (1)»): N boxes, one character
 * each from what the span holds once its placeholders are filled — the rest left empty for the hand.
 */
const boxCells = (html: string, values: Map<string, string>): string =>
  html.replace(/<span class="cells c(\d+)">([^<]*)<\/span>/g, (_m, n: string, inner: string) => {
    const count = Number(n);
    const text = inner
      .replace(/\{\{\s*([a-zA-Z0-9.]+)\s*\}\}/g, (_k, key: string) => values.get(key) ?? '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, '');
    const chars = [...text].slice(0, count);
    const boxes = Array.from({ length: count }, (_x, i) => {
      const char = chars[i];
      return `<i>${char === undefined ? '&nbsp;' : escapeHtml(char)}</i>`;
    });
    return `<span class="cells c${count}">${boxes.join('')}</span>`;
  });

const formBody = (
  template: Pick<ContractTemplateDoc, 'sections' | 'signatures' | 'language'>,
  values: ContractVariableValue[],
  letterhead: Letterhead,
): string => {
  const map = new Map(values.map((v) => [v.key, v.value]));
  const fill = (html: string): string => {
    return boxCells(html, map).replace(/\{\{\s*([a-zA-Z0-9.]+)\s*\}\}/g, (_m, key: string) => {
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
  // A paper with its own head («نموذج رقم (1)», the authority's form) wears no company letterhead.
  const letterheadHtml = ownHead(template)
    ? ''
    : `<div class="letterhead">
      <div class="lines">${letterhead.lines.join('<br />')}</div>
      <img src="${letterhead.logoDataUri}" alt="" />
    </div>`;
  return `
  <div class="form-doc">
    ${letterheadHtml}
    ${fill(template.sections.header)}
    <main>${fill(template.sections.body)}</main>
    ${signatures === '' ? '' : `<div class="signatures">${signatures}</div>`}
    ${template.sections.footer.trim() === '' ? '' : `<div class="form-foot">${fill(template.sections.footer)}</div>`}
  </div>`;
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
<head><meta charset="utf-8" /><style>${PRINT_CSS}${FORM_CSS}${pictureCss(template.sections.header + template.sections.body)}</style></head>
<body>
${formSection(template, formBody(template, values, letterhead))}
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
  const contracts = parts.filter((part) => part.kind === 'contract').length;
  const brandCss =
    (contract?.kind === 'contract'
      ? brandCssFor(contract.options.branding, '.doc-contract') +
        pageFootCss(contract.template.sections.footer, contracts === 1)
      : '') + pictureCss(parts.map((part) => part.template.sections.header + part.template.sections.body).join(''));
  const sections = parts
    .map((part, index) => {
      const pageBreak = index === 0 ? '' : ' style="break-before: page;"';
      return part.kind === 'contract'
        ? `<section class="doc doc-contract"${pageBreak}>${contractBody(part.template, part.values, part.options)}</section>`
        : formSection(part.template, formBody(part.template, part.values, letterhead), pageBreak);
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
