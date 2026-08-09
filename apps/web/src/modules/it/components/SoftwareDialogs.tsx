// The software register's dialogs (design §2.8).
//
// Two things these screens must SAY OUT LOUD, because the server enforces them and a user who
// learns them from a 409 or a surprise event has already lost work:
//   * a product is archived, never deleted — installations and licences point at it forever;
//   * a seat overrun is ALLOWED and warns (FR-10, §13-Q5), so the form must not look like a gate.
import { useEffect, useState } from 'react';
import { type ItSoftwareInstallationDto, type ItSoftwareProductDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Checkbox, Field, Input, Textarea } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useCreateItSoftwareInstallation,
  useCreateItSoftwareProduct,
  useItLicenses,
  useRemoveItSoftwareInstallation,
  useUpdateItSoftwareProduct,
} from '../api/it-queries';
import { AssetPicker } from './AssetPicker';
import { SoftwareProductPicker } from './SoftwareProductPicker';

const Alert = ({ message }: { message: string }): JSX.Element => (
  <p
    role="alert"
    className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
  >
    {message}
  </p>
);

const errorText = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

export const SoftwareProductDialog = ({
  open,
  onClose,
  product,
}: {
  open: boolean;
  onClose: () => void;
  /** null → create mode. */
  product: ItSoftwareProductDto | null;
}): JSX.Element => {
  const t = useT();
  const [name, setName] = useState('');
  const [publisher, setPublisher] = useState('');
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(product?.name ?? '');
    setPublisher(product?.publisher ?? '');
    setActive(product?.active ?? true);
    setError(null);
  }, [open, product]);

  const create = useCreateItSoftwareProduct();
  const update = useUpdateItSoftwareProduct();
  const busy = create.isPending || update.isPending;

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      if (product === null) {
        await create.mutateAsync({
          name: name.trim(),
          ...(publisher.trim() === '' ? {} : { publisher: publisher.trim() }),
        });
        toast.success(t('it.software.created'));
      } else {
        await update.mutateAsync({
          id: product.id,
          body: {
            name: name.trim(),
            publisher: publisher.trim() === '' ? null : publisher.trim(),
            active,
            version: product.version,
          },
        });
        toast.success(t('it.software.updated'));
      }
      onClose();
    } catch (err) {
      setError(errorText(err, t('common.error')));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={product === null ? t('it.software.add') : t('it.software.edit')}
      description={t('it.software.dialogHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={busy} disabled={name.trim() === ''} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {error !== null && <Alert message={error} />}
      <div className="space-y-4">
        {/* A product name is a proper noun, so there is one field and not an ar/en pair — the
            same reason a vendor's name is one field. */}
        <Field label={t('it.software.fields.name')} required hint={t('it.software.nameHint')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('it.software.fields.publisher')}>
          <Input value={publisher} onChange={(e) => setPublisher(e.target.value)} />
        </Field>
        {product !== null && (
          <div>
            <Checkbox
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              label={t('it.software.activeLabel')}
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('it.software.archiveHint')}
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
};

export const RecordInstallationDialog = ({
  open,
  onClose,
  assetId,
}: {
  open: boolean;
  onClose: () => void;
  /** Pre-picked when recorded from an asset's own screen. */
  assetId?: string;
}): JSX.Element => {
  const t = useT();
  const [asset, setAsset] = useState(assetId ?? '');
  const [productId, setProductId] = useState('');
  const [softwareVersion, setSoftwareVersion] = useState('');
  const [licenseId, setLicenseId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useCreateItSoftwareInstallation();

  useEffect(() => {
    if (!open) return;
    setAsset(assetId ?? '');
    setProductId('');
    setSoftwareVersion('');
    setLicenseId('');
    setError(null);
  }, [open, assetId]);

  // Only this product's licences can be consumed — one entitles one product, and offering the
  // others would let a user make a choice the server has to refuse.
  const licenses = useItLicenses({ productId, pageSize: 25 }, productId !== '');

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      await create.mutateAsync({
        assetId: asset,
        productId,
        ...(softwareVersion.trim() === '' ? {} : { softwareVersion: softwareVersion.trim() }),
        ...(licenseId === '' ? {} : { licenseId }),
      });
      toast.success(t('it.software.installed'));
      onClose();
    } catch (err) {
      setError(errorText(err, t('common.error')));
    }
  };

  const chosen = (licenses.data?.items ?? []).find((l) => l.id === licenseId);
  const willExceed =
    chosen !== undefined && chosen.seats !== null && chosen.seatsUsed >= chosen.seats;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('it.software.install')}
      description={t('it.software.installHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={create.isPending}
            disabled={asset === '' || productId === ''}
            onClick={() => void submit()}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      {error !== null && <Alert message={error} />}
      <div className="space-y-4">
        <Field label={t('it.software.fields.asset')} required>
          <AssetPicker value={asset} onChange={setAsset} />
        </Field>
        <Field label={t('it.software.fields.product')} required>
          <SoftwareProductPicker
            value={productId}
            onChange={(id) => {
              setProductId(id);
              setLicenseId('');
            }}
          />
        </Field>
        <Field label={t('it.software.fields.softwareVersion')}>
          <Input
            value={softwareVersion}
            onChange={(e) => setSoftwareVersion(e.target.value)}
            dir="ltr"
          />
        </Field>
        {productId !== '' && (
          <Field label={t('it.software.fields.license')} hint={t('it.software.licenseHint')}>
            <ul className="space-y-1">
              {(licenses.data?.items ?? []).length === 0 ? (
                <li className="text-xs text-slate-500 dark:text-slate-400">
                  {t('it.software.noLicences')}
                </li>
              ) : (
                (licenses.data?.items ?? []).map((license) => (
                  <li key={license.id}>
                    <button
                      type="button"
                      aria-pressed={license.id === licenseId}
                      onClick={() => setLicenseId(license.id === licenseId ? '' : license.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-start text-sm ${
                        license.id === licenseId
                          ? 'border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-200'
                          : 'border-slate-200 text-slate-700 dark:border-slate-800 dark:text-slate-200'
                      }`}
                    >
                      <span>{t(`it.licenses.state.${license.state}`)}</span>
                      <span className="font-mono text-xs" dir="ltr">
                        {license.seatsUsed}
                        {license.seats === null ? ' / ∞' : ` / ${String(license.seats)}`}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </Field>
        )}
        {/* A warning, never a gate: FR-10 says an overrun is recorded and announced, and the
            technician is not the person to stop. The button stays enabled on purpose. */}
        {willExceed && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            {t('it.software.seatWarning')}
          </p>
        )}
      </div>
    </Dialog>
  );
};

export const RemoveInstallationDialog = ({
  open,
  onClose,
  installation,
}: {
  open: boolean;
  onClose: () => void;
  installation: ItSoftwareInstallationDto;
}): JSX.Element => {
  const t = useT();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const remove = useRemoveItSoftwareInstallation();

  useEffect(() => {
    if (open) {
      setNote('');
      setError(null);
    }
  }, [open]);

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      await remove.mutateAsync({
        id: installation.id,
        body: note.trim() === '' ? {} : { note: note.trim() },
      });
      toast.success(t('it.software.removed'));
      onClose();
    } catch (err) {
      setError(errorText(err, t('common.error')));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('it.software.remove')}
      description={t('it.software.removeHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => void submit()}>
            {t('it.software.remove')}
          </Button>
        </>
      }
    >
      {error !== null && <Alert message={error} />}
      <div className="space-y-4">
        <Field label={t('it.software.fields.note')}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          {t('it.software.removeKeepsHistory')}
        </p>
      </div>
    </Dialog>
  );
};
