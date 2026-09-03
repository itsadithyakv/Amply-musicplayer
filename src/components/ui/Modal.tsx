import clsx from 'clsx';
import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '@/components/ui/IconButton';
import { useDialog } from '@/hooks/useDialog';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const sizeClass: Record<ModalSize, string> = {
  sm: 'max-w-[420px]',
  md: 'max-w-[560px]',
  lg: 'max-w-[760px]',
  xl: 'max-w-[1040px]',
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  size?: ModalSize;
  role?: 'dialog' | 'alertdialog';
  initialFocusRef?: RefObject<HTMLElement | null>;
  footer?: ReactNode;
  /** Hide the corner close button (e.g. for confirm dialogs with explicit actions). */
  hideClose?: boolean;
  /** Remove the default body padding (for edge-to-edge content). */
  flush?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * Portalled dialog: soft backdrop scrim, raised card, Escape/focus-trap/focus-restore via useDialog.
 * Covers the whole window (including the player bar) — modals are modal.
 */
export const Modal = ({
  open,
  onClose,
  title,
  description,
  size = 'md',
  role = 'dialog',
  initialFocusRef,
  footer,
  hideClose = false,
  flush = false,
  className,
  children,
}: ModalProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useDialog({ open, onClose, containerRef, initialFocusRef });

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="anim-fade-in fixed inset-0 z-modal flex items-center justify-center bg-amply-backdrop/55 p-6"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={containerRef}
        role={role}
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={clsx(
          'anim-scale-in neu-raised flex max-h-[85vh] w-full flex-col rounded-lg outline-none',
          sizeClass[size],
          className,
        )}
      >
        {title || !hideClose ? (
          <div className={clsx('flex items-start justify-between gap-4', flush ? 'px-6 pt-5' : 'px-6 pt-5')}>
            <div className="min-w-0">
              {title ? (
                <h2 id={titleId} className="text-[18px] font-bold tracking-[-0.02em] text-amply-textPrimary">
                  {title}
                </h2>
              ) : null}
              {description ? (
                <p id={descriptionId} className="mt-1 text-[12px] leading-relaxed text-amply-textSecondary">
                  {description}
                </p>
              ) : null}
            </div>
            {!hideClose ? <IconButton name="close" label="Close" size="sm" variant="flat" onClick={onClose} /> : null}
          </div>
        ) : null}
        <div className={clsx('min-h-0 flex-1 overflow-y-auto', flush ? 'pt-4' : 'px-6 pb-6 pt-4')}>{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 px-6 pb-5">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
};
