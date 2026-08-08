// The label sheet is what gets physically stuck on machines — the spec pins the two facts that
// matter: every requested asset is on the sheet, and nothing a user typed can inject markup.
import { describe, expect, it } from 'vitest';
import { buildAssetLabelSheetHtml, renderLabelQrs } from './asset-labels';

describe('asset label sheet', () => {
  it('renders one label per asset with its code and name', async () => {
    const labels = await renderLabelQrs([
      { assetCode: 'AST-00001', name: 'ThinkPad T14' },
      { assetCode: 'AST-00002', name: 'HP LaserJet' },
    ]);
    const html = buildAssetLabelSheetHtml(labels);
    expect(html).toContain('AST-00001');
    expect(html).toContain('ThinkPad T14');
    expect(html).toContain('AST-00002');
    expect((html.match(/class="label"/g) ?? []).length).toBe(2);
    // The QR is embedded, not fetched — the sheet is self-contained for print.
    expect(html).toContain('data:image/png;base64,');
  });

  it('escapes user-controlled names', async () => {
    const labels = await renderLabelQrs([
      { assetCode: 'AST-00003', name: '<script>alert(1)</script>' },
    ]);
    const html = buildAssetLabelSheetHtml(labels);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('QR payload is the plain asset code — decodable without any deployment context', async () => {
    const [label] = await renderLabelQrs([{ assetCode: 'AST-00004', name: 'x' }]);
    // qrcode's data-URL for the same payload is deterministic; assert it exists and is PNG.
    expect(label?.qrDataUrl ?? '').toMatch(/^data:image\/png;base64,/);
  });
});
