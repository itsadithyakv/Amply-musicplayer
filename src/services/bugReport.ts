/**
 * Bug reports, delivered by email through EmailJS (https://www.emailjs.com). The webview posts the
 * report straight to EmailJS's REST API; the email template on EmailJS decides where it goes.
 * Nothing is sent until the user presses Send, and the technical details are optional.
 */

import { invoke } from '@tauri-apps/api/core';
import { readPreference, writePreference } from '@/services/preferences';
import { recentErrors, scrubUserPaths } from '@/services/errorLog';

/** The public key is meant to ship in client code; EmailJS limits what it can do. */
export const EMAILJS = {
  endpoint: 'https://api.emailjs.com/api/v1.0/email/send',
  serviceId: 'service_wrivwqo',
  templateId: 'template_emt2dhk',
  publicKey: 'qFdV7E6GG4xYS1i7f',
} as const;

export const REPORT_KINDS = ['bug', 'crash', 'idea'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

const KIND_SUBJECT: Record<ReportKind, string> = {
  bug: 'Bug',
  crash: 'Crash or freeze',
  idea: 'Idea',
};

export const LIMITS = {
  summaryMin: 4,
  summaryMax: 120,
  detailsMin: 10,
  detailsMax: 4000,
  stepsMax: 2000,
  emailMax: 254,
} as const;

/** One report a minute and five a day keeps a stuck button or a spammer off the EmailJS quota. */
const COOLDOWN_MS = 60_000;
const DAILY_MAX = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const SENT_KEY = 'bugReport.sent';
const SEND_TIMEOUT_MS = 15_000;

export interface ReportDraft {
  kind: ReportKind;
  summary: string;
  details: string;
  steps: string;
  email: string;
  includeDiagnostics: boolean;
}

export interface ReportEnvironment {
  appVersion: string;
  plan: 'Pro' | 'Free';
  language: string;
  librarySize: number;
  windows: string;
  install: string;
  appLog: string;
}

export type ReportField = 'summary' | 'details' | 'steps' | 'email';
export type ReportError = 'summaryShort' | 'summaryLong' | 'detailsShort' | 'detailsLong' | 'stepsLong' | 'emailInvalid';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The first problem with each field, or nothing when the draft can be sent. */
export const validateDraft = (draft: ReportDraft): Partial<Record<ReportField, ReportError>> => {
  const errors: Partial<Record<ReportField, ReportError>> = {};
  const summary = draft.summary.trim();
  const details = draft.details.trim();
  const email = draft.email.trim();
  if (summary.length < LIMITS.summaryMin) errors.summary = 'summaryShort';
  else if (summary.length > LIMITS.summaryMax) errors.summary = 'summaryLong';
  if (details.length < LIMITS.detailsMin) errors.details = 'detailsShort';
  else if (details.length > LIMITS.detailsMax) errors.details = 'detailsLong';
  if (draft.steps.trim().length > LIMITS.stepsMax) errors.steps = 'stepsLong';
  if (email && (email.length > LIMITS.emailMax || !EMAIL.test(email))) errors.email = 'emailInvalid';
  return errors;
};

const NOT_INCLUDED = 'Not included';

export const newReportId = (random: () => number = Math.random): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i += 1) id += alphabet[Math.floor(random() * alphabet.length)];
  return `AMP-${id}`;
};

const formatErrors = (): string =>
  recentErrors()
    .map((entry) => `${new Date(entry.at).toISOString()}  ${entry.message}`)
    .join('\n');

/**
 * The variables the EmailJS template uses. Version, plan and language always go; they say which
 * build the report is about and carry nothing personal. The rest is up to the user.
 */
export const buildTemplateParams = (draft: ReportDraft, env: ReportEnvironment, reportId: string, now = new Date()): Record<string, string> => {
  const withDetails = draft.includeDiagnostics;
  const errors = withDetails ? formatErrors() : '';
  return {
    report_id: reportId,
    kind: KIND_SUBJECT[draft.kind],
    summary: scrubUserPaths(draft.summary.trim()),
    details: scrubUserPaths(draft.details.trim()),
    steps: scrubUserPaths(draft.steps.trim()) || 'Not given',
    reply_to: draft.email.trim(),
    reply_note: draft.email.trim() ? draft.email.trim() : 'No reply address given',
    app_version: env.appVersion,
    plan: env.plan,
    language: env.language,
    windows: withDetails ? env.windows : NOT_INCLUDED,
    install: withDetails ? env.install : NOT_INCLUDED,
    library_size: withDetails ? String(env.librarySize) : NOT_INCLUDED,
    recent_errors: withDetails ? errors || 'None recorded' : NOT_INCLUDED,
    app_log: withDetails ? env.appLog || 'Empty' : NOT_INCLUDED,
    sent_at: now.toISOString(),
  };
};

/** The technical details as the user sees them before sending. */
export const describeDiagnostics = (env: ReportEnvironment): string => {
  const errors = formatErrors();
  return [
    `Amply ${env.appVersion} (${env.plan}), ${env.install}`,
    env.windows,
    `Language: ${env.language}`,
    `Songs in library: ${env.librarySize}`,
    '',
    'Recent errors:',
    errors || 'None recorded',
    '',
    'App log (last lines):',
    env.appLog || 'Empty',
  ].join('\n');
};

/** The whole report as plain text, for copying when it cannot be sent. */
export const reportAsText = (params: Record<string, string>): string =>
  [
    `Amply ${params.kind}: ${params.summary}  [${params.report_id}]`,
    '',
    params.details,
    '',
    `Steps: ${params.steps}`,
    `Reply to: ${params.reply_note}`,
    '',
    `Amply ${params.app_version} (${params.plan}), ${params.install}, ${params.windows}, ${params.language}`,
    `Songs: ${params.library_size}`,
    '',
    'Recent errors:',
    params.recent_errors,
    '',
    'App log:',
    params.app_log,
  ].join('\n');

const readSentTimes = (): number[] =>
  readPreference(SENT_KEY, (value): value is string => /^[\d,]*$/.test(value), '')
    .split(',')
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);

/** Milliseconds until another report may be sent; 0 when one can go now. */
export const reportWaitMs = (now = Date.now(), sent = readSentTimes()): number => {
  const today = sent.filter((at) => now - at < DAY_MS).sort((a, b) => a - b);
  const last = today[today.length - 1];
  const cooldown = last ? Math.max(0, last + COOLDOWN_MS - now) : 0;
  const daily = today.length >= DAILY_MAX ? today[today.length - DAILY_MAX] + DAY_MS - now : 0;
  return Math.max(cooldown, daily);
};

const recordSent = (now = Date.now()): void => {
  const kept = readSentTimes().filter((at) => now - at < DAY_MS);
  writePreference(SENT_KEY, [...kept, now].join(','));
};

interface NativeContext {
  windows: string;
  install: string;
  logTail: string;
}

/** Windows version, install type and the end of the log from the Rust side. */
export const loadNativeContext = async (): Promise<NativeContext> => {
  try {
    return await invoke<NativeContext>('bug_report_context');
  } catch {
    return { windows: typeof navigator === 'undefined' ? 'Unknown' : navigator.userAgent, install: 'Unknown', logTail: '' };
  }
};

export type SendResult = 'sent' | 'offline' | 'rateLimited' | 'failed';

export const sendBugReport = async (params: Record<string, string>, fetcher: typeof fetch = fetch): Promise<SendResult> => {
  if (reportWaitMs() > 0) {
    return 'rateLimited';
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'offline';
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const response = await fetcher(EMAILJS.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: EMAILJS.serviceId,
        template_id: EMAILJS.templateId,
        user_id: EMAILJS.publicKey,
        template_params: params,
      }),
      signal: controller.signal,
    });
    if (response.ok) {
      recordSent();
      return 'sent';
    }
    if (response.status === 429) {
      return 'rateLimited';
    }
    console.error('[Amply] bug report rejected', response.status, await response.text().catch(() => ''));
    return 'failed';
  } catch {
    return typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'failed';
  } finally {
    clearTimeout(timer);
  }
};
