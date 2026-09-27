import { useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useT } from '@/i18n';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive action: confirm button becomes danger-styled. */
  danger?: boolean;
  busy?: boolean;
}

export const ConfirmDialog = ({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
}: ConfirmDialogProps) => {
  const { t } = useT();
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      role="alertdialog"
      hideClose
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="ghost" onClick={onClose} disabled={busy}>
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      {typeof body === 'string' ? <p className="text-[13px] leading-relaxed text-amply-textSecondary">{body}</p> : body}
    </Modal>
  );
};
