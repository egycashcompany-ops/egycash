// The template rendering engine (Sprint 3.3 plan §2b) — placeholder substitution only.
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../shared/errors';
import {
  escapeHtml,
  interpolate,
  renderTemplate,
  validateVariables,
  wrapEmailHtml,
} from './notification.rendering';

describe('validateVariables', () => {
  it('passes when every declared variable is present in data', () => {
    expect(() => validateVariables(['name', 'count'], { name: 'Ali', count: '3' })).not.toThrow();
  });

  it('throws ValidationError listing every missing variable', () => {
    try {
      validateVariables(['name', 'count'], { name: 'Ali' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const details = (error as ValidationError).details;
      expect(details).toEqual([
        { field: 'data.count', code: 'REQUIRED', message: 'missing template variable "count"' },
      ]);
    }
  });

  it('ignores extra data keys not declared by the template', () => {
    expect(() => validateVariables(['name'], { name: 'Ali', extra: 'ignored' })).not.toThrow();
  });
});

describe('interpolate', () => {
  it('substitutes every declared placeholder', () => {
    expect(interpolate('Hello {{name}}, you have {{count}} items', { name: 'Ali', count: '3' })).toBe(
      'Hello Ali, you have 3 items',
    );
  });

  it('leaves an unmatched placeholder as literal text', () => {
    expect(interpolate('Hello {{name}}', {})).toBe('Hello {{name}}');
  });

  it('does not treat data values as further templates (no recursive interpolation)', () => {
    expect(interpolate('{{a}}', { a: '{{b}}' })).toBe('{{b}}');
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<b>a & b "c" 'd'</b>`)).toBe(
      '&lt;b&gt;a &amp; b &quot;c&quot; &#39;d&#39;&lt;/b&gt;',
    );
  });
});

describe('renderTemplate', () => {
  it('renders both languages for body, and subject when declared', () => {
    const rendered = renderTemplate(
      {
        subject: { ar: 'مرحبا {{name}}', en: 'Hello {{name}}' },
        body: { ar: 'النص {{name}}', en: 'Body {{name}}' },
      },
      { name: 'Ali' },
    );
    expect(rendered).toEqual({
      subject: { ar: 'مرحبا Ali', en: 'Hello Ali' },
      body: { ar: 'النص Ali', en: 'Body Ali' },
    });
  });

  it('passes through a null subject (in-app-only template)', () => {
    const rendered = renderTemplate(
      { subject: null, body: { ar: 'النص', en: 'Body' } },
      {},
    );
    expect(rendered.subject).toBeNull();
  });
});

describe('wrapEmailHtml', () => {
  it('escapes body text and converts newlines to <br>', () => {
    const html = wrapEmailHtml('line one\n<script>alert(1)</script>');
    expect(html).toContain('line one<br>&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
