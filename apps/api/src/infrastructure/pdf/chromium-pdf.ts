// Headless-chromium PDF driver (contracts design D8/A21, approved Q1). Disabled unless
// CHROMIUM_PATH points at a chromium binary — dev/CI stay hermetic and the print-view
// fallback covers exports. Deterministic settings: A4, fixed margins, printBackground,
// no browser headers/footers (the document carries its own A14 integrity line).
import { env } from '../config/env';
import { logger } from '../logging/logger';

export const pdfDriverEnabled = (): boolean => env.CHROMIUM_PATH !== '';

export const renderPdfFromHtml = async (html: string): Promise<Buffer | null> => {
  if (!pdfDriverEnabled()) return null;
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch((error: unknown) => {
      logger.warn({ err: error }, 'chromium close failed');
    });
  }
};
