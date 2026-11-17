// Printing from a hidden frame of its own: the card (one card-sized page per canvas — the card prints
// its front only, like the current system's PDF) and the A4 receipt the employee signs for it.
//
// A frame rather than the app's own page, so nothing of ECMS's layout (the sidebar, the dark theme,
// the dialog) can reach the paper, and the page size is the document's own. Every picture is
// decoded before the dialog opens — opening it first is what once printed a blank front.
const CARD_STYLE = `@page { size: 88.9mm 55.88mm; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
img { display: block; width: 88.9mm; height: 55.88mm; break-after: page; break-inside: avoid; }
img:last-child { break-after: auto; }`;

/** Prints a whole HTML body with its own style sheet, once every picture in it has loaded. */
export const printHtml = async (
  body: string,
  style: string,
  dir: 'rtl' | 'ltr' = 'ltr',
): Promise<void> => {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;inset-inline-start:-9999px;';
  document.body.appendChild(frame);
  try {
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (doc === null || win === null) throw new Error('printing is not available');
    doc.open();
    doc.write(
      `<!doctype html><html dir="${dir}" lang="${dir === 'rtl' ? 'ar' : 'en'}"><head><meta charset="utf-8">` +
        `<base href="${document.baseURI}"><style>${style}</style></head><body>${body}</body></html>`,
    );
    doc.close();
    await Promise.all([...doc.images].map((image) => image.decode()));
    await doc.fonts.ready.catch(() => undefined);
    win.focus();
    win.print();
  } finally {
    // After the dialog closes: `print()` blocks until then in every browser that prints a frame.
    setTimeout(() => frame.remove(), 1000);
  }
};

export const printCardPages = (pages: readonly HTMLCanvasElement[]): Promise<void> =>
  printHtml(
    pages.map((canvas) => `<img alt="" src="${canvas.toDataURL('image/jpeg', 0.97)}">`).join(''),
    CARD_STYLE,
  );
