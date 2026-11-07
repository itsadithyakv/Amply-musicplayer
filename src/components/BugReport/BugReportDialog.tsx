import clsx from 'clsx';
import { useEffect, useId, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import packageInfo from '../../../package.json';
import { Button, Modal, SegmentedTabs, TextInput, Toggle } from '@/components/ui';
import { getLanguage, useT, type MessageKey } from '@/i18n';
import {
  LIMITS,
  buildTemplateParams,
  describeDiagnostics,
  loadNativeContext,
  newReportId,
  reportAsText,
  sendBugReport,
  validateDraft,
  type ReportDraft,
  type ReportEnvironment,
  type ReportError,
  type ReportKind,
  type SendResult,
} from '@/services/bugReport';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { useProStore } from '@/store/proStore';

export const PRIVACY_POLICY_URL = 'https://itsadithyakv.github.io/Amply-musicplayer/privacy/';
const CONTACT_EMAIL = 'adithyakrishnan.vinod@gmail.com';

const EMPTY_DRAFT: ReportDraft = { kind: 'bug', summary: '', details: '', steps: '', email: '', includeDiagnostics: true };

const ERROR_KEYS: Record<ReportError, MessageKey> = {
  summaryShort: 'report.error.summaryShort',
  summaryLong: 'report.error.summaryLong',
  detailsShort: 'report.error.detailsShort',
  detailsLong: 'report.error.detailsLong',
  stepsLong: 'report.error.stepsLong',
  emailInvalid: 'report.error.emailInvalid',
};

const SEND_ERROR_KEYS: Record<Exclude<SendResult, 'sent'>, MessageKey> = {
  offline: 'report.error.offline',
  rateLimited: 'report.error.rateLimited',
  failed: 'report.error.failed',
};

export const TextArea = ({
  label,
  value,
  onValueChange,
  placeholder,
  rows,
  max,
  error,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  rows: number;
  max: number;
  error?: string;
}) => {
  const id = useId();
  const errorId = useId();
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <label htmlFor={id} className="amply-kicker">
          {label}
        </label>
        <span className={clsx('text-[11px] tabular-nums', value.length > max ? 'text-amply-danger' : 'text-amply-textMuted')}>
          {value.length}/{max}
        </span>
      </div>
      <textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onValueChange(event.target.value)}
        className="neu-pressed-sm w-full resize-none rounded-sm bg-transparent px-4 py-3 text-[13px] leading-relaxed text-amply-textPrimary outline-none placeholder:text-amply-textMuted"
      />
      {error ? (
        <p id={errorId} className="px-1 text-[11px] font-medium text-amply-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
};

/** Writes a bug report or idea and sends it to the developer through EmailJS. */
export const BugReportDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { t } = useT();
  const showToast = usePlayerStore((state) => state.showToast);
  const isPro = useProStore((state) => state.isPro);
  const [draft, setDraft] = useState<ReportDraft>(EMPTY_DRAFT);
  const [attempted, setAttempted] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<Exclude<SendResult, 'sent'> | null>(null);
  const [env, setEnv] = useState<ReportEnvironment | null>(null);
  const [reportId, setReportId] = useState(() => newReportId());

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    void loadNativeContext().then((native) => {
      if (cancelled) return;
      setEnv({
        appVersion: packageInfo.version,
        plan: useProStore.getState().isPro ? 'Pro' : 'Free',
        language: getLanguage(),
        librarySize: useLibraryStore.getState().songs.length,
        windows: native.windows,
        install: native.install,
        appLog: native.logTail,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [open, isPro]);

  const errors = validateDraft(draft);
  const fieldError = (field: keyof typeof errors, max?: number) => {
    const error = attempted ? errors[field] : undefined;
    return error ? t(ERROR_KEYS[error], { max: max ?? 0 }) : undefined;
  };
  const update = (patch: Partial<ReportDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSendError(null);
  };

  const close = () => {
    setAttempted(false);
    setSendError(null);
    setShowDetails(false);
    onClose();
  };

  const params = () => (env ? buildTemplateParams(draft, env, reportId) : null);

  const send = async () => {
    setAttempted(true);
    const built = params();
    if (Object.keys(errors).length > 0 || !built) {
      return;
    }
    setSending(true);
    const result = await sendBugReport(built);
    setSending(false);
    if (result === 'sent') {
      showToast(t('report.sent', { id: reportId }));
      setDraft(EMPTY_DRAFT);
      setReportId(newReportId());
      close();
      return;
    }
    setSendError(result);
  };

  const copy = async () => {
    const built = params();
    if (!built) return;
    try {
      await navigator.clipboard.writeText(reportAsText(built));
      showToast(t('report.copied', { email: CONTACT_EMAIL }));
    } catch {
      showToast(t('report.copyFailed'));
    }
  };

  const kinds: Array<{ label: string; value: ReportKind }> = [
    { label: t('report.kind.bug'), value: 'bug' },
    { label: t('report.kind.crash'), value: 'crash' },
    { label: t('report.kind.idea'), value: 'idea' },
  ];

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      title={t('report.title')}
      description={t('report.description')}
      footer={
        <>
          <button
            type="button"
            onClick={() => void openUrl(PRIVACY_POLICY_URL).catch(() => undefined)}
            className="mr-auto text-[12px] font-medium text-amply-textSecondary underline-offset-2 hover:text-amply-textPrimary hover:underline"
          >
            {t('report.privacy')}
          </button>
          {sendError ? (
            <Button icon="list" onClick={() => void copy()} disabled={!env}>
              {t('report.copy')}
            </Button>
          ) : (
            <Button onClick={close}>{t('common.cancel')}</Button>
          )}
          <Button variant="primary" icon="check" onClick={() => void send()} loading={sending} disabled={!env}>
            {t('report.send')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <SegmentedTabs size="sm" ariaLabel={t('report.kind')} value={draft.kind} onChange={(kind) => update({ kind })} tabs={kinds} />

        <div className="grid gap-1.5">
          <TextInput
            label={t('report.summary')}
            value={draft.summary}
            onValueChange={(summary) => update({ summary })}
            placeholder={draft.kind === 'idea' ? t('report.summaryPlaceholder.idea') : t('report.summaryPlaceholder')}
            maxLength={LIMITS.summaryMax + 20}
            aria-invalid={fieldError('summary') ? true : undefined}
            autoFocus
          />
          {fieldError('summary', LIMITS.summaryMax) ? (
            <p className="px-1 text-[11px] font-medium text-amply-danger">{fieldError('summary', LIMITS.summaryMax)}</p>
          ) : null}
        </div>

        <TextArea
          label={draft.kind === 'idea' ? t('report.details.idea') : t('report.details')}
          value={draft.details}
          onValueChange={(details) => update({ details })}
          placeholder={draft.kind === 'idea' ? t('report.detailsPlaceholder.idea') : t('report.detailsPlaceholder')}
          rows={5}
          max={LIMITS.detailsMax}
          error={fieldError('details', LIMITS.detailsMax)}
        />

        {draft.kind !== 'idea' ? (
          <TextArea
            label={t('report.steps')}
            value={draft.steps}
            onValueChange={(steps) => update({ steps })}
            placeholder={t('report.stepsPlaceholder')}
            rows={3}
            max={LIMITS.stepsMax}
            error={fieldError('steps', LIMITS.stepsMax)}
          />
        ) : null}

        <div className="grid gap-1.5">
          <TextInput
            type="email"
            label={t('report.email')}
            value={draft.email}
            onValueChange={(email) => update({ email })}
            placeholder={t('report.emailPlaceholder')}
            maxLength={LIMITS.emailMax}
            autoComplete="email"
            aria-invalid={fieldError('email') ? true : undefined}
          />
          <p className={clsx('px-1 text-[11px]', fieldError('email') ? 'font-medium text-amply-danger' : 'text-amply-textMuted')}>
            {fieldError('email') ?? t('report.emailHint')}
          </p>
        </div>

        <div className="grid gap-2">
          <Toggle
            label={t('report.diagnostics.label')}
            description={t('report.diagnostics.description')}
            checked={draft.includeDiagnostics}
            onChange={(includeDiagnostics) => update({ includeDiagnostics })}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <p className="text-[11px] text-amply-textMuted">{t('report.always')}</p>
            {draft.includeDiagnostics ? (
              <button
                type="button"
                aria-expanded={showDetails}
                onClick={() => setShowDetails((value) => !value)}
                className="text-[12px] font-medium text-amply-textSecondary underline-offset-2 hover:text-amply-textPrimary hover:underline"
              >
                {showDetails ? t('report.diagnostics.hide') : t('report.diagnostics.show')}
              </button>
            ) : null}
          </div>
          {draft.includeDiagnostics && showDetails ? (
            <pre className="neu-pressed-sm max-h-[180px] overflow-auto whitespace-pre-wrap break-words rounded-sm px-4 py-3 font-mono text-[11px] leading-relaxed text-amply-textSecondary">
              {env ? describeDiagnostics(env) : t('report.loading')}
            </pre>
          ) : null}
        </div>

        {sendError ? (
          <p role="alert" className="neu-pressed-sm rounded-sm px-3.5 py-2.5 text-[12px] leading-relaxed text-amply-danger">
            {t(SEND_ERROR_KEYS[sendError])}
          </p>
        ) : null}
      </div>
    </Modal>
  );
};
