// The Word letters' page — his letterhead, his frame, his paragraphs and his signers.
//
// His Word page: A4, 1in margins, a 3pt + ¾pt page border 22.5pt in from the edge, his header
// (the logo, the company and its department). Times New Roman bold (the theme's «majorBidi»),
// Arial for the header and the general manager; Word's line model (each paragraph its size, its
// line and the 8pt after it). Ported unchanged from the approved sample.
//
// THE SHEET'S CSS IS SCOPED: every selector starts with `.wl-sheet`, because the sheet is injected
// into the app through `dangerouslySetInnerHTML`. No `@font-face`, no `@page` here — those are
// written once into the print document's <head>.
import type { FleetCustodySignBlock } from '@ecms/contracts';
import { EGYCASH_LOGO } from '../../gold/lib/egycash-logo';
import { esc } from './custody-paper-format';
import { STACK } from './custody-paper-fonts';
import { LETTER_HEADER, LETTER_SIGN_LINES } from './custody-paper-wording';

export const LETTER_CSS = [
  `.wl-sheet{--tnr:${STACK.tnr};--arial:${STACK.arial};position:relative;box-sizing:border-box;width:210mm;height:297mm;margin:0;background:#fff;color:#000;overflow:hidden;direction:rtl;text-align:right;font-family:var(--tnr);font-weight:700;-webkit-print-color-adjust:exact;print-color-adjust:exact}`,
  '.wl-sheet *{box-sizing:border-box;margin:0;padding:0;letter-spacing:0;word-spacing:0;font-style:normal}',
  '.wl-sheet .wl-frame{position:absolute;inset:22.5pt;border:3pt solid #000}',
  '.wl-sheet .wl-frame::after{content:"";position:absolute;inset:.75pt;border:.75pt solid #000}',
  '.wl-sheet .wl-logo{position:absolute;left:57pt;top:31.5pt;width:111.75pt;height:auto;display:block}',
  '.wl-sheet .wl-hdr{position:absolute;top:36pt;left:72pt;right:72pt;font:700 14pt/16.1pt var(--arial);text-align:right;white-space:pre}',
  '.wl-sheet .wl-hdr .l2{padding-right:22.5pt}',
  '.wl-sheet .wl-body{position:absolute;top:72pt;left:72pt;right:72pt}',
  '.wl-sheet .wl-body p,.wl-sheet .wl-body .body{white-space:pre-wrap;margin:0 0 8pt}',
  '.wl-sheet .wl-body p.sg{white-space:pre}',
  '.wl-sheet .wl-body .ar,.wl-sheet .wl-body .ar p{font-family:var(--arial)}',
  '.wl-sheet .wl-u{text-decoration:underline;text-decoration-thickness:.075em;text-underline-offset:.3em;text-decoration-skip-ink:none}',
  `.wl-sheet .tw{font-family:${STACK.tatweel}}`,
  '.wl-sheet .wl-br{display:block;height:8pt}',
  `.wl-sheet .wl-c{font-family:${STACK.tnrC}}`,
  '.wl-sheet .wl-t{border-collapse:collapse;table-layout:fixed;margin:0}',
  '.wl-sheet .wl-t td{border:.5pt solid #000;padding:0 5.4pt;text-align:right;vertical-align:top;white-space:pre-wrap;overflow:hidden}',
  '.wl-sheet .n4{font-weight:400}',
  // The app's reset gives every image `max-width:100%`, the print tab gives it none: neither.
  '.wl-sheet img{display:block;max-width:none}',
].join('\n');

/** A Word paragraph: its size, its line, the 8pt after it. `html` is escaped by the caller. */
export const para = (html: string, pt: number, lh: number, extra = ''): string =>
  `<p style="font-size:${pt}pt;line-height:${lh}pt${extra}">${html}</p>`;
/** A «التوقيع : (      )» line — Word lets its run of spaces reach past the margin; it never wraps. */
export const sigPara = (html: string, pt: number, lh: number, extra = ''): string =>
  `<p class="sg" style="font-size:${pt}pt;line-height:${lh}pt${extra}">${html}</p>`;
/** An empty Word paragraph: its line and the 8pt after it. */
export const blank = (lh: number): string => `<p style="height:${lh}pt"></p>`;
export const CENTER = ';text-align:center';

/** The first signer — right-aligned, his eight leading spaces before «التوقيع». */
export const signer1 = (b: FleetCustodySignBlock, pt: number, lh: number): string =>
  [
    para(esc(b.office), pt, lh),
    para(esc(b.name), pt, lh),
    sigPara(esc(LETTER_SIGN_LINES.first), pt, lh),
  ].join('');
/** The second signer — his indents, centred over the left half of the page. */
export const signer2 = (b: FleetCustodySignBlock, pt: number, lh: number): string =>
  [
    para(esc(b.office), pt, lh, `${CENTER};margin-left:-12.3pt;margin-right:207pt`),
    para(esc(b.name), pt, lh, `${CENTER};margin-left:-40.5pt;margin-right:238pt`),
    sigPara(esc(LETTER_SIGN_LINES.second), pt, lh, ';margin-left:-7.8pt;margin-right:247.5pt'),
  ].join('');
/** The general manager — Arial; his name first, his office under it. */
export const signer3 = (b: FleetCustodySignBlock, pt: number, lh: number): string =>
  `<div class="ar">${[
    para(esc(b.name), pt, lh, ';text-align:left;margin-left:9pt;margin-right:27pt'),
    para(esc(b.office), pt, lh, `${CENTER};margin-left:-58.5pt;margin-right:216pt`),
    sigPara(
      esc(LETTER_SIGN_LINES.third),
      pt,
      lh,
      ';text-align:left;margin-left:4.5pt;margin-right:180pt',
    ),
  ].join('')}</div>`;

/** One A4 letter sheet around a body. */
export const letterPage = (body: string): string =>
  `<style>${LETTER_CSS}</style><div class="wl-sheet" data-paper-sheet="true"><img class="wl-logo" src="${EGYCASH_LOGO}" alt="" /><div class="wl-hdr"><div>${esc(LETTER_HEADER.company)}</div><div class="l2">${esc(LETTER_HEADER.dept)}</div></div><div class="wl-body">${body}</div><div class="wl-frame"></div></div>`;
