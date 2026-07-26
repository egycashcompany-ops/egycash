// Pure helpers for template HTML (frozen contracts design D6/D7, security A11):
// a conservative allow-list sanitizer (no scripts/embeds/event handlers/external URLs —
// stored template HTML can never carry active content) and {{placeholder}} extraction.

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4',
  'strong', 'b', 'em', 'i', 'u', 's',
  'ul', 'ol', 'li', 'blockquote', 'span', 'div',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
]);

/** Only TipTap's text-align style survives; everything else is stripped (A11). */
const STYLE_RE = /^text-align:\s*(left|right|center|justify);?$/;

const sanitizeAttributes = (attrs: string): string => {
  let out = '';
  const attrRe = /([a-zA-Z-]+)\s*=\s*("[^"]*"|'[^']*')/g;
  for (const match of attrs.matchAll(attrRe)) {
    const name = (match[1] ?? '').toLowerCase();
    const rawValue = (match[2] ?? '').slice(1, -1);
    if (name === 'dir' && (rawValue === 'rtl' || rawValue === 'ltr')) out += ` dir="${rawValue}"`;
    else if (name === 'style' && STYLE_RE.test(rawValue.trim())) out += ` style="${rawValue.trim()}"`;
    else if (name === 'colspan' || name === 'rowspan') {
      if (/^\d{1,2}$/.test(rawValue)) out += ` ${name}="${rawValue}"`;
    }
    // Everything else (class, id, on*, href, src, data-*) is dropped.
  }
  return out;
};

/**
 * Allow-list sanitizer: keeps structural/print tags with dir/text-align only. Unknown
 * tags are removed WITH their wrapper (content kept); script/style/iframe-like tags are
 * removed with their content.
 */
export const sanitizeTemplateHtml = (html: string): string => {
  // Drop dangerous containers with their entire content first.
  let out = html.replace(
    /<(script|style|iframe|object|embed|link|meta|form|input|textarea|svg|math)\b[\s\S]*?(<\/\1>|\/>|>)/gi,
    '',
  );
  // Then process every remaining tag against the allow-list.
  out = out.replace(/<\/?([a-zA-Z0-9]+)((?:\s+[^<>]*?)?)\s*\/?>/g, (whole, rawTag: string, attrs: string) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';
    if (whole.startsWith('</')) return `</${tag}>`;
    const selfClosing = tag === 'br' || tag === 'hr' ? ' /' : '';
    return `<${tag}${sanitizeAttributes(attrs)}${selfClosing}>`;
  });
  return out;
};

/** Distinct `{{key}}` placeholders in document order. */
export const extractPlaceholders = (html: string): string[] => {
  const keys: string[] = [];
  for (const match of html.matchAll(/\{\{\s*([a-zA-Z0-9.]+)\s*\}\}/g)) {
    const key = match[1] ?? '';
    if (key !== '' && !keys.includes(key)) keys.push(key);
  }
  return keys;
};
