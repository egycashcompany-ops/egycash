// The template rendering engine (Sprint 3.3 plan §2b): `{{variable}}` placeholder
// substitution only — deliberately not a full templating language (no conditionals,
// loops, expressions). Missing declared variables fail fast; extra `data` keys are
// ignored. HTML-escaping applies only to the email HTML part.
import { ValidationError } from '../../shared/errors';

const PLACEHOLDER = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

/** Fails fast on a missing declared variable — this runs in trusted platform code. */
export const validateVariables = (
  declaredVariables: string[],
  data: Record<string, string>,
): void => {
  const missing = declaredVariables.filter((name) => !(name in data));
  if (missing.length > 0) {
    throw new ValidationError(
      missing.map((field) => ({
        field: `data.${field}`,
        code: 'REQUIRED',
        message: `missing template variable "${field}"`,
      })),
      'Missing required template variables',
    );
  }
};

/** Find-and-replace only — an undeclared/unmatched placeholder is left as literal text. */
export const interpolate = (text: string, data: Record<string, string>): string =>
  text.replace(PLACEHOLDER, (match, name: string) => (name in data ? (data[name] ?? '') : match));

export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export interface LocalizedText {
  ar: string;
  en: string;
}

const renderBilingual = (source: LocalizedText, data: Record<string, string>): LocalizedText => ({
  ar: interpolate(source.ar, data),
  en: interpolate(source.en, data),
});

export interface RenderedTemplate {
  subject: LocalizedText | null;
  body: LocalizedText;
}

/** Renders both languages (in-app displays whichever the client's session locale needs). */
export const renderTemplate = (
  template: { subject: LocalizedText | null; body: LocalizedText },
  data: Record<string, string>,
): RenderedTemplate => ({
  subject: template.subject === null ? null : renderBilingual(template.subject, data),
  body: renderBilingual(template.body, data),
});

/** A generic, code-owned HTML shell — not authored per-template (Sprint 3.3 plan §2b). */
export const wrapEmailHtml = (bodyText: string): string => {
  const escaped = escapeHtml(bodyText).replace(/\n/g, '<br>');
  return `<!doctype html><html><body style="font-family:sans-serif;line-height:1.5;color:#111">${escaped}</body></html>`;
};
