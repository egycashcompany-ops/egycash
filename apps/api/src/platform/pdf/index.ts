// Platform seam for PDF rendering (modules never import infrastructure directly).
export { pdfDriverEnabled, renderPdfFromHtml } from '../../infrastructure/pdf/chromium-pdf';
