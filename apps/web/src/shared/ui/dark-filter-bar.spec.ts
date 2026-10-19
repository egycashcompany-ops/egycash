// The dark filter bar, compiled by Tailwind itself as the app's CSS is — what it does to the
// controls inside it on a small computer screen (1024–1279).
//
// MACH-7: the bar's `lg:max-xl:[&_input]:!px-1.5` reached EVERY input under it — the open list's
// own search box too (`MultiSelect`: a `[role=listbox]` panel drawn inside the control, its box
// padded `ps-8` for the magnifier at its start). The bar's `!important` padding won, the text
// started 6px in, under a 16px icon, and a code typed into the ATM ID picker sat under the
// magnifier. How the bar's padding ranks against an icon filter's gutter is
// `fleet/fleet-date-picker.spec.tsx`.
import postcss, { type AtRule, type Rule } from 'postcss';
import tailwindcss from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import { DARK_FILTER_BAR } from './dark-filter-bar';

/** The bar's rules that pad an input at 1024–1279. */
const smallScreenInputPadding = async (): Promise<Rule[]> => {
  const result = await postcss([
    tailwindcss({
      content: [{ raw: `<div class="${DARK_FILTER_BAR}"></div>`, extension: 'html' }],
      corePlugins: { preflight: false },
      darkMode: 'class',
    }),
  ]).process('@tailwind utilities;', { from: undefined });
  const rules: Rule[] = [];
  result.root.walkRules((rule) => {
    const pads = rule.nodes.some(
      (node) => node.type === 'decl' && /^padding-(?:left|right)$/u.test(node.prop),
    );
    const media = (rule.parent as AtRule | undefined)?.type === 'atrule';
    if (pads && media && rule.selector.includes('max-xl') && /input\b/u.test(rule.selector)) {
      rules.push(rule);
    }
  });
  return rules;
};

describe('the dark bar on a small computer screen (1024–1279)', () => {
  it('pads the bar’s own boxes, and leaves an open list’s search box its own padding', async () => {
    const rules = await smallScreenInputPadding();
    expect(rules).toHaveLength(1);
    const selector = rules[0]?.selector ?? '';
    // An input is padded only when its parent is not inside an open list's panel…
    expect(selector).toMatch(/ :where\(:not\(\[role=listbox\] \*\)\) > input$/u);
    // …and every input it reaches is padded as firmly as before.
    expect(rules[0]?.toString()).toContain('!important');
  });
});
