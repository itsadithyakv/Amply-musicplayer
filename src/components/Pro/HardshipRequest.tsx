import { useCallback, useState } from 'react';
import { create } from 'zustand';
import { openUrl } from '@tauri-apps/plugin-opener';
import packageInfo from '../../../package.json';
import { TextArea } from '@/components/BugReport/BugReportDialog';
import { Button, Modal, TextInput } from '@/components/ui';
import { getLanguage, useT, type MessageKey } from '@/i18n';
import { newReportId, sendBugReport, type SendResult } from '@/services/bugReport';
import { readPreference, writePreference } from '@/services/preferences';
import {
  buildProRequestParams,
  REDEEM_URL,
  REQUEST_AGAIN_AFTER_MS,
  REQUEST_LIMITS,
  REQUEST_SENT_PREFERENCE,
  validateProRequest,
  type ProRequestError,
} from '@/services/proRequest';
import { usePlayerStore } from '@/store/playerStore';
import { useProStore } from '@/store/proStore';

const isTimestamp = (value: string): value is string => /^\d+$/.test(value);
const readSentAt = (): number => Number(readPreference(REQUEST_SENT_PREFERENCE, isTimestamp, '')) || 0;

/** Open state outside the upgrade dialog, which closes as this opens; `sentAt` drives the link. */
const useProRequestDialog = create<{ open: boolean; sentAt: number }>(() => ({ open: false, sentAt: readSentAt() }));

const FIELD_ERRORS: Record<ProRequestError, MessageKey> = {
  emailMissing: 'pro.request.error.emailMissing',
  emailInvalid: 'report.error.emailInvalid',
  noteShort: 'pro.request.error.noteShort',
  noteLong: 'pro.request.error.noteLong',
};

const SEND_ERRORS: Record<Exclude<SendResult, 'sent'>, MessageKey> = {
  offline: 'pro.request.error.offline',
  rateLimited: 'pro.request.error.rateLimited',
  failed: 'pro.request.error.failed',
};

export const openRedeemPage = () => {
  void openUrl(REDEEM_URL).catch(() => window.open(REDEEM_URL, '_blank', 'noopener'));
};

/**
 * The quiet way in, at the foot of the upgrade dialog. The request appears only once the trial has
 * been used, so everyone tries Pro first; "Redeem a code" is always there for someone who has one.
 */
export const HardshipRequestButton = () => {
  const { t } = useT();
  const trialUsed = useProStore((state) => !state.trial.available && !state.owned);
  const sentAt = useProRequestDialog((state) => state.sentAt);
  const requested = sentAt > 0 && Date.now() - sentAt < REQUEST_AGAIN_AFTER_MS;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {trialUsed ? (
        requested ? (
          <span className="text-[12px] text-amply-textMuted">{t('pro.request.requested')}</span>
        ) : (
          <button
            type="button"
            className="text-[12px] text-amply-textSecondary underline-offset-2 hover:text-amply-textPrimary hover:underline"
            onClick={() => {
              useProStore.getState().closePaywall();
              useProRequestDialog.setState({ open: true });
            }}
          >
            {t('pro.request.link')}
          </button>
        )
      ) : null}
      <button type="button" className="text-[12px] text-amply-textSecondary underline-offset-2 hover:text-amply-textPrimary hover:underline" onClick={openRedeemPage}>
        {t('pro.request.redeem')}
      </button>
    </div>
  );
};

/** "Can't afford Pro?": an email address, an optional note, and a promise of a free code. */
export const ProRequestDialog = () => {
  const { t } = useT();
  const open = useProRequestDialog((state) => state.open);
  const showToast = usePlayerStore((state) => state.showToast);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<MessageKey | null>(null);

  // Stable, so the dialog's focus handling does not run again (and steal focus) on every keystroke.
  const close = useCallback(() => {
    useProRequestDialog.setState({ open: false });
    setAttempted(false);
    setSendError(null);
  }, []);
  const errors = validateProRequest({ email, note });
  const shown = (field: 'email' | 'note') => {
    const error = errors[field];
    return error && (attempted || error === 'noteLong') ? t(FIELD_ERRORS[error], { max: REQUEST_LIMITS.noteMax }) : undefined;
  };

  const send = async () => {
    setAttempted(true);
    setSendError(null);
    if (Object.keys(errors).length) {
      return;
    }
    setSending(true);
    const params = buildProRequestParams({ email, note }, { appVersion: packageInfo.version, language: getLanguage() }, newReportId());
    const result = await sendBugReport(params);
    setSending(false);
    if (result === 'sent') {
      const now = Date.now();
      writePreference(REQUEST_SENT_PREFERENCE, String(now));
      useProRequestDialog.setState({ sentAt: now });
      close();
      setEmail('');
      setNote('');
      showToast(t('pro.request.sent'));
    } else {
      setSendError(SEND_ERRORS[result]);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="sm"
      title={t('pro.request.title')}
      description={t('pro.request.body')}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('pro.paywall.notNow')}
          </Button>
          <Button variant="primary" icon="sparkle" onClick={() => void send()} loading={sending}>
            {t('pro.request.send')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <TextInput
            type="email"
            label={t('pro.request.email')}
            value={email}
            onValueChange={setEmail}
            placeholder={t('pro.request.emailPlaceholder')}
            maxLength={REQUEST_LIMITS.emailMax}
            autoComplete="email"
            aria-invalid={shown('email') ? true : undefined}
            autoFocus
          />
          {shown('email') ? <p className="px-1 text-[11px] font-medium text-amply-danger">{shown('email')}</p> : null}
        </div>
        <TextArea
          label={t('pro.request.note')}
          value={note}
          onValueChange={setNote}
          placeholder={t('pro.request.notePlaceholder')}
          rows={3}
          max={REQUEST_LIMITS.noteMax}
          error={shown('note')}
        />
        <p className="text-[12px] leading-relaxed text-amply-textSecondary">{t('pro.request.howItWorks')}</p>
        {sendError ? <p className="text-[12px] font-medium text-amply-danger">{t(sendError)}</p> : null}
      </div>
    </Modal>
  );
};
