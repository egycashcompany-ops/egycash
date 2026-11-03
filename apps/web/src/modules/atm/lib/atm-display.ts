// How the ATM pages read (2026-11-03, «خلى حجم الكلام فى الصفحات وإذا كان Bold أو لأ + درجة لون خطوط
// الجداول .. أقدر أتحكم فيها من /atm/settings»): the attributes `AtmDisplayScope` puts around every
// ATM page, and the rules in `styles.css` that read them.
//
// Only what differs from the pages' own look is set on the pages: at the defaults no attribute is
// there, no rule applies, and every page draws exactly as before. The settings card's preview sets
// all three (`explicit`), so it shows the choice being made whatever the page around it shows.
import { type CSSProperties } from 'react';
import { type AtmDisplaySetting } from '@ecms/contracts';

export type AtmDisplayScopeProps = Record<`data-${string}`, string> & { style?: CSSProperties };

/** Pure: what a scope carries for a setting — on the pages, only what differs from their own look. */
export const atmDisplayScopeProps = (
  display: AtmDisplaySetting,
  explicit = false,
): AtmDisplayScopeProps => {
  const attributes: Record<`data-${string}`, string> = { 'data-atm-display': 'true' };
  const style: Record<string, string> = {};
  if (explicit || display.textSize !== 100) {
    attributes['data-atm-text'] = 'scaled';
    style['--atm-text-scale'] = String(display.textSize / 100);
  }
  if (explicit || display.bold) {
    attributes['data-atm-weight'] = display.bold ? 'bold' : 'regular';
    style['--atm-bold'] = display.bold ? '1' : '0';
  }
  if (explicit || display.tableLines !== 'normal') {
    attributes['data-atm-lines'] = display.tableLines;
  }
  return Object.keys(style).length === 0
    ? attributes
    : { ...attributes, style: style as CSSProperties };
};
