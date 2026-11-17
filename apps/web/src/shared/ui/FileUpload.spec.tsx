// The shared picker's ✕ obeys `disabled`, as its drop zone does. A screen disables the picker while
// it sends the file; a live ✕ then emptied the screen's file mid-request and reset what it held
// about the request — the assets' bulk upload lost the result of a write that had happened
// (2026-11-16). Static markup (apps/web has no DOM): the list is rendered with a file in it.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { type Locale } from '@ecms/contracts';
import { localeSlice } from '../../store/localeSlice';
import { FileUpload, FileUploadList } from './FileUpload';

const render = (node: JSX.Element, locale: Locale = 'ar'): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
    },
  });
  return renderToStaticMarkup(<Provider store={store}>{node}</Provider>);
};

const SHEET = new File([new Uint8Array(2048)], 'عهدة فرع الشيخ زايد.xlsx');

/** The ✕ of the one file listed. */
const removeButton = (markup: string): string =>
  /<button[^>]*aria-label="إزالة"[^>]*>/u.exec(markup)?.[0] ?? '';

describe('FileUpload — the chosen file’s ✕', () => {
  it('is disabled while the picker is', () => {
    const button = removeButton(
      render(<FileUploadList files={[SHEET]} disabled onRemove={() => undefined} />),
    );
    expect(button).not.toBe('');
    expect(button).toContain('disabled=""');
  });

  it('removes the file when the picker is live — every other screen keeps its ✕', () => {
    const markup = render(<FileUploadList files={[SHEET]} onRemove={() => undefined} />);
    expect(markup).toContain('عهدة فرع الشيخ زايد.xlsx');
    expect(removeButton(markup)).not.toBe('');
    expect(removeButton(markup)).not.toContain('disabled=""');
  });

  it('lists nothing before a file is chosen, and the picker renders its zone alone', () => {
    expect(render(<FileUploadList files={[]} onRemove={() => undefined} />)).toBe('');
    const picker = render(<FileUpload onFiles={() => undefined} disabled />);
    expect(picker).toMatch(/<input[^>]*type="file"[^>]*disabled=""/u);
    expect(picker).not.toContain('<ul');
  });
});
