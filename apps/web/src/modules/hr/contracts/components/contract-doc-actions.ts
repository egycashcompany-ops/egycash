// Print / Download PDF row actions (frozen design §4). Both exports are audited
// server-side under contract.print; the print path opens the STORED snapshot (A20)
// in a new window and invokes the browser's print dialog — never a client re-render.
import { contractDocumentHtml, contractPdfTicket } from '../api/contract-api';

/** Open the immutable snapshot in a new window and trigger printing. */
export const printContract = async (id: string): Promise<void> => {
  const html = await contractDocumentHtml(id);
  const win = window.open('', '_blank');
  if (win === null) throw new Error('popup blocked');
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  // Give fonts/layout a beat before the dialog opens.
  win.setTimeout(() => win.print(), 350);
};

/** Resolve the generated PDF's short-lived ticket and open it; false when not ready. */
export const downloadContractPdf = async (id: string): Promise<boolean> => {
  const { ready, ticket } = await contractPdfTicket(id);
  if (!ready || ticket === null) return false;
  window.open(ticket.url, '_blank', 'noopener');
  return true;
};
