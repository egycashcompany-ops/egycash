// «عاوز عمود كمان لصورة الايصال زى شاشة السيارات اقدر ارفع صوره»: the photo of a shipment's paper
// receipt, in its own column on the day board. It is the Fleet receipts' image cell
// (`fleet/components/ReceiptImageCell.tsx`) on a shipment, with the same look so the two boards
// read alike: no photo → the dashed box with the cloud upload (a camera-or-device menu on a phone);
// a photo → view, replace, delete in the owner's image box (`row-actions-look`). The bytes are
// guarded, so they are fetched with the session and shown as an object URL.
//
// The cell checks the grant itself, as the Fleet cells do, so the board never gates the column:
// whoever may edit the shipment (`operationsShipment.edit`) manages its photo; a reader only sees it.
// And SEEING it is a grant too: the bytes are served on `operationsShipment.view`, which the vault's
// receive queue does not require — a treasurer without it gets a dash, never an eye that answers
// 403. A screen that only looks (`readOnly`, the vault queue) offers no upload, replace or delete
// to anyone.
import { useEffect, useState } from 'react';
import { type OperationsShipmentDto } from '@ecms/contracts';
import { PhotoPickButton } from '../../../shared/ui/PhotoPick';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { toast } from '../../../shared/ui/toast/toast-store';
import { EyeIcon } from '../../../shared/ui/icons';
import { ZoomableImage } from '../../fleet/components/ZoomableImage';
import { IMAGE_EMPTY_BOX, IMAGE_GROUP, actionTone } from '../../fleet/components/row-actions-look';
import {
  ArrowUpFromLineIcon,
  CloudUploadIcon,
  Trash2Icon,
} from '../../fleet/components/row-action-icons';
import { fetchShipmentReceiptImage } from '../api/operations-api';
import {
  useDeleteShipmentReceiptImage,
  useUploadShipmentReceiptImage,
} from '../api/operations-queries';

/** The types the server's file category accepts (`operations-shipment-receipts`) — photos only. */
export const SHIPMENT_RECEIPT_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';

/** The guarded bytes as an object URL, refetched when the photo is replaced (a new `fileId`). */
export const useShipmentReceiptImageUrl = (
  shipmentId: string,
  fileId: string | null,
): { url: string | null; loading: boolean; failed: boolean } => {
  const [state, setState] = useState<{ url: string | null; loading: boolean; failed: boolean }>({
    url: null,
    loading: false,
    failed: false,
  });
  useEffect(() => {
    if (fileId === null || shipmentId === '') {
      setState({ url: null, loading: false, failed: false });
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    setState({ url: null, loading: true, failed: false });
    void fetchShipmentReceiptImage(shipmentId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, loading: false, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, loading: false, failed: true });
      });
    return () => {
      cancelled = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [shipmentId, fileId]);
  return state;
};

export const ShipmentReceiptImageDeleteDialog = ({
  open,
  onClose,
  row,
}: {
  open: boolean;
  onClose: () => void;
  row: OperationsShipmentDto | null;
}): JSX.Element => {
  const t = useT();
  const remove = useDeleteShipmentReceiptImage();
  const confirm = async (): Promise<void> => {
    if (row === null) return;
    await remove.mutateAsync(row.id);
    toast.success(t('operations.shipment.receiptImage.deleted'));
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('operations.shipment.receiptImage.deleteTitle')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => void confirm()}>
            {t('common.delete')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t('operations.shipment.receiptImage.deleteBody')}
      </p>
    </Dialog>
  );
};

/** One per board, opened by a row's eye. `row` null is closed. */
export const ShipmentReceiptImagePreviewDialog = ({
  open,
  onClose,
  row,
  readOnly = false,
}: {
  open: boolean;
  onClose: () => void;
  row: OperationsShipmentDto | null;
  /** Opened from a screen that only looks — no delete, whoever is reading. */
  readOnly?: boolean;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const fileId = row?.receiptImage?.fileId ?? null;
  const { url, loading, failed } = useShipmentReceiptImageUrl(row?.id ?? '', open ? fileId : null);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        size="xl"
        title={t('operations.shipment.receiptImage.title')}
        // The operating day, as the board's own date column prints it — a calendar day, so it is
        // sliced rather than run through the browser's timezone.
        description={row === null ? '' : row.collectionDate.slice(0, 10)}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('common.close')}
            </Button>
            {!readOnly && can('operationsShipment.edit') && (
              <Button variant="danger" onClick={() => setConfirming(true)}>
                {t('operations.shipment.receiptImage.delete')}
              </Button>
            )}
          </>
        }
      >
        {loading && (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        )}
        {failed && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {t('operations.shipment.receiptImage.loadFailed')}
          </p>
        )}
        {url !== null && (
          <ZoomableImage src={url} alt={t('operations.shipment.receiptImage.title')} />
        )}
      </Dialog>
      <ShipmentReceiptImageDeleteDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          onClose();
        }}
        row={row}
      />
    </>
  );
};

export const ShipmentReceiptImageCell = ({
  row,
  onPreview,
  readOnly = false,
}: {
  row: OperationsShipmentDto;
  onPreview: (row: OperationsShipmentDto) => void;
  /** A screen that only looks at the photo (the vault queue) — no upload, replace or delete. */
  readOnly?: boolean;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const upload = useUploadShipmentReceiptImage();
  const [confirming, setConfirming] = useState(false);
  const mayEdit = !readOnly && can('operationsShipment.edit');
  // The bytes are read on the shipment grant (`GET …/receipt-image`).
  const mayView = can('operationsShipment.view');
  // `?? null`: a board row from before the column existed may not carry the field at all.
  const image = row.receiptImage ?? null;

  const pick = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    await upload.mutateAsync({ id: row.id, file });
    toast.success(t('operations.shipment.receiptImage.uploaded'));
  };

  if (image === null) {
    if (!mayEdit) return <span className="text-slate-400">—</span>;
    return (
      <PhotoPickButton
        accept={SHIPMENT_RECEIPT_IMAGE_ACCEPT}
        className={IMAGE_EMPTY_BOX}
        disabled={upload.isPending}
        label={t('operations.shipment.receiptImage.upload')}
        data-shipment-receipt-upload={row.id}
        onFile={(file) => void pick(file)}
      >
        <CloudUploadIcon className="h-4 w-4" />
      </PhotoPickButton>
    );
  }

  // A photo the reader may neither open nor manage: a dash, as a row with none reads for someone
  // who may not add one.
  if (!mayView && !mayEdit) return <span className="text-slate-400">—</span>;

  // The owner's image box, as on the vehicles and receipts screens — the eye, the replace arrow,
  // the bin.
  return (
    <span className={IMAGE_GROUP} data-image-actions="shipment-receipt">
      {mayView && (
        <button
          type="button"
          data-shipment-receipt-view={row.id}
          className={actionTone('view')}
          aria-label={t('operations.shipment.receiptImage.view')}
          title={t('operations.shipment.receiptImage.view')}
          onClick={() => onPreview(row)}
        >
          <EyeIcon className="h-4 w-4" />
        </button>
      )}
      {mayEdit && (
        <PhotoPickButton
          accept={SHIPMENT_RECEIPT_IMAGE_ACCEPT}
          className={actionTone('upload')}
          disabled={upload.isPending}
          label={t('operations.shipment.receiptImage.replace')}
          data-shipment-receipt-replace={row.id}
          onFile={(file) => void pick(file)}
        >
          <ArrowUpFromLineIcon className="h-4 w-4" />
        </PhotoPickButton>
      )}
      {mayEdit && (
        <button
          type="button"
          data-shipment-receipt-delete={row.id}
          className={actionTone('delete')}
          aria-label={t('operations.shipment.receiptImage.delete')}
          title={t('operations.shipment.receiptImage.delete')}
          onClick={() => setConfirming(true)}
        >
          <Trash2Icon className="h-4 w-4" />
        </button>
      )}
      <ShipmentReceiptImageDeleteDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        row={row}
      />
    </span>
  );
};
