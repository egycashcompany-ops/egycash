// Scan surface (design §2.2): type or scan an asset code and land on that asset.
//
// The QR payload is the plain `assetCode` (D2) — not a URL — so a hardware scanner behaves as a
// keyboard: it types the code and presses Enter. That is the whole interaction, and it is why
// this page is a single autofocused input rather than a camera component: the codes are printed
// on stickers and read by the scanners the warehouse already owns, and a phone camera scanning
// the same sticker fills the same box.
//
// Resolution is a real API call (`GET /it/assets/by-code/:code`), so an unknown code is the
// server's 404, not a guess made here.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardBody } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { Field, Input } from '../../../shared/ui/form';
import { Spinner } from '../../../shared/ui/Spinner';
import { QrIcon } from '../../../shared/ui/icons';
import { errorMessage } from '../../../shared/lib/errors';
import { useAppSelector } from '../../../store';
import * as api from '../api/it-api';

export const AssetScanPage = (): JSX.Element => {
  const t = useT();
  const navigate = useNavigate();
  const locale = useAppSelector((state) => state.locale.locale);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // A scanner types into whatever holds focus — so the box must hold it from the first frame.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const resolve = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmed = code.trim();
    if (trimmed === '' || busy) return;
    setBusy(true);
    setError(null);
    try {
      const asset = await api.getAssetByCode(trimmed);
      navigate(`/it/assets/${asset.id}`);
    } catch (err) {
      setError(errorMessage(err, locale));
      // Clear and refocus so the next scan does not append to the failed one.
      setCode('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('it.nav.scan')}
        description={t('it.scan.subtitle')}
        breadcrumbs={[{ label: t('it.module.title'), to: '/it' }, { label: t('it.nav.scan') }]}
      />
      <div className="mx-auto max-w-lg">
        <Card>
          <CardBody>
            <form onSubmit={(e) => void resolve(e)} className="space-y-4">
              <div className="flex justify-center">
                <QrIcon className="h-12 w-12 text-brand-500" aria-hidden="true" />
              </div>
              <Field
                label={t('it.scan.codeLabel')}
                hint={t('it.scan.codeHint')}
                error={error ?? undefined}
                htmlFor="it-scan-code"
              >
                <Input
                  id="it-scan-code"
                  ref={inputRef}
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    if (error !== null) setError(null);
                  }}
                  error={error !== null}
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="AST-00001"
                />
              </Field>
              {/* Screen readers get the outcome even though the visible cue is the field error. */}
              <p aria-live="polite" className="sr-only">
                {error ?? ''}
              </p>
              <Button type="submit" className="w-full" disabled={code.trim() === '' || busy}>
                {busy ? <Spinner /> : t('it.scan.resolve')}
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </PageContainer>
  );
};
