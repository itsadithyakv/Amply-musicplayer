/**
 * "Can't afford Pro?": someone who has used the trial leaves their email and a word about their
 * situation, and the developer may send them a free Microsoft Store promotional code for Amply Pro.
 * It is offered only after the trial, asks for a short note and can be sent once a month per PC, so
 * it stays for the people who need it. It goes through the same EmailJS template as bug reports, marked as
 * a request, and counts toward the same sending limits.
 */

import { scrubUserPaths } from '@/services/errorLog';

export const REDEEM_URL = 'https://redeem.microsoft.com';

export const REQUEST_LIMITS = { emailMax: 254, noteMin: 20, noteMax: 1000 } as const;

/** One request per PC a month; the developer answers each one by hand. */
export const REQUEST_AGAIN_AFTER_MS = 30 * 86_400_000;
export const REQUEST_SENT_PREFERENCE = 'pro.requestSentAt';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ProRequestDraft {
  email: string;
  note: string;
}

export type ProRequestError = 'emailMissing' | 'emailInvalid' | 'noteShort' | 'noteLong';

export const validateProRequest = (draft: ProRequestDraft): Partial<Record<keyof ProRequestDraft, ProRequestError>> => {
  const errors: Partial<Record<keyof ProRequestDraft, ProRequestError>> = {};
  const email = draft.email.trim();
  if (!email) errors.email = 'emailMissing';
  else if (email.length > REQUEST_LIMITS.emailMax || !EMAIL.test(email)) errors.email = 'emailInvalid';
  const note = draft.note.trim().length;
  if (note < REQUEST_LIMITS.noteMin) errors.note = 'noteShort';
  else if (note > REQUEST_LIMITS.noteMax) errors.note = 'noteLong';
  return errors;
};

const NOT_INCLUDED = 'Not included';

/** The bug report template's variables, filled in for a request. Nothing technical goes with it. */
export const buildProRequestParams = (
  draft: ProRequestDraft,
  env: { appVersion: string; language: string },
  requestId: string,
  now = new Date(),
): Record<string, string> => {
  const email = draft.email.trim();
  const note = scrubUserPaths(draft.note.trim());
  return {
    report_id: requestId,
    kind: 'Pro code request',
    summary: `Free Amply Pro code for ${email}`,
    details: `${note}\n\nTo help: generate a single-use promo code for the amply_pro add-on in Partner Center and reply to this email with it. It is redeemed at ${REDEEM_URL}.`,
    steps: 'Not given',
    reply_to: email,
    reply_note: email,
    app_version: env.appVersion,
    plan: 'Free',
    language: env.language,
    windows: NOT_INCLUDED,
    install: NOT_INCLUDED,
    library_size: NOT_INCLUDED,
    recent_errors: NOT_INCLUDED,
    app_log: NOT_INCLUDED,
    sent_at: now.toISOString(),
  };
};
