import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTemplateParams, EMAILJS, LIMITS, newReportId, reportWaitMs, sendBugReport, validateDraft, type ReportDraft, type ReportEnvironment } from '@/services/bugReport';
import { clearPreferences } from '@/services/preferences';
import { clearErrorLogForTests, recordError, scrubUserPaths } from '@/services/errorLog';

const draft: ReportDraft = {
  kind: 'bug',
  summary: 'Lyrics missing',
  details: String.raw`Nothing shows for C:\Users\Adi Kumar\Music\song.mp3`,
  steps: '',
  email: '',
  includeDiagnostics: true,
};

const env: ReportEnvironment = {
  appVersion: '1.8.0',
  plan: 'Free',
  language: 'en',
  librarySize: 1200,
  windows: 'Windows 11 24H2 (build 26100.1)',
  install: 'Microsoft Store',
  appLog: 'WARN lyrics timed out',
};

afterEach(() => {
  clearErrorLogForTests();
  clearPreferences();
  vi.restoreAllMocks();
});

describe('bug report drafts', () => {
  it('need a summary and some detail, and a real email when one is given', () => {
    expect(validateDraft(draft)).toEqual({});
    expect(validateDraft({ ...draft, summary: 'no', details: 'short' })).toEqual({ summary: 'summaryShort', details: 'detailsShort' });
    expect(validateDraft({ ...draft, email: 'not-an-email' })).toEqual({ email: 'emailInvalid' });
    expect(validateDraft({ ...draft, details: 'x'.repeat(LIMITS.detailsMax + 1) })).toEqual({ details: 'detailsLong' });
  });

  it('remove the Windows account name from what the user wrote', () => {
    const params = buildTemplateParams(draft, env, 'AMP-TEST01');
    expect(params.details).toBe(String.raw`Nothing shows for ~\Music\song.mp3`);
    expect(params.steps).toBe('Not given');
    expect(params.reply_note).toBe('No reply address given');
  });

  it('leave the technical details out when asked, but keep the version', () => {
    recordError('boom at', String.raw`C:\Users\adi\x.flac`);
    const withDetails = buildTemplateParams(draft, env, 'AMP-TEST01');
    expect(withDetails.recent_errors).toContain(String.raw`boom at ~\x.flac`);
    expect(withDetails.windows).toBe(env.windows);

    const without = buildTemplateParams({ ...draft, includeDiagnostics: false }, env, 'AMP-TEST01');
    expect(without.app_version).toBe('1.8.0');
    expect(without.windows).toBe('Not included');
    expect(without.recent_errors).toBe('Not included');
    expect(without.app_log).toBe('Not included');
  });
});

describe('report ids', () => {
  it('are short and avoid look-alike characters', () => {
    expect(newReportId(() => 0)).toBe('AMP-AAAAAA');
    expect(newReportId()).toMatch(/^AMP-[A-HJ-NP-Z2-9]{6}$/);
  });
});

describe('sending', () => {
  it('waits a minute between reports and allows five a day', () => {
    const now = 10 * 24 * 60 * 60 * 1000;
    expect(reportWaitMs(now, [])).toBe(0);
    expect(reportWaitMs(now, [now - 20_000])).toBe(40_000);
    const five = [5, 4, 3, 2, 1].map((hours) => now - hours * 60 * 60 * 1000);
    expect(reportWaitMs(now, five)).toBe(19 * 60 * 60 * 1000);
  });

  it('posts the template to EmailJS and then holds off the next one', async () => {
    const fetcher = vi.fn(async () => new Response('OK', { status: 200 }));
    expect(await sendBugReport({ summary: 'x' }, fetcher as unknown as typeof fetch)).toBe('sent');
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(EMAILJS.endpoint);
    expect(JSON.parse(String(init.body))).toMatchObject({
      service_id: EMAILJS.serviceId,
      template_id: EMAILJS.templateId,
      user_id: EMAILJS.publicKey,
      template_params: { summary: 'x' },
    });
    expect(await sendBugReport({ summary: 'y' }, fetcher as unknown as typeof fetch)).toBe('rateLimited');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reports a rejected request as failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetcher = vi.fn(async () => new Response('The template ID is invalid', { status: 400 }));
    expect(await sendBugReport({}, fetcher as unknown as typeof fetch)).toBe('failed');
  });
});

describe('scrubUserPaths', () => {
  it('matches the Rust scrubber', () => {
    expect(scrubUserPaths(String.raw`C:\Users\Adi Kumar\Music\a.mp3 and c:/users/adi/Music/b.flac`)).toBe(String.raw`~\Music\a.mp3 and ~/Music/b.flac`);
    expect(scrubUserPaths(String.raw`home is C:\Users\adi now`)).toBe('home is ~ now');
    expect(scrubUserPaths(String.raw`D:\Music\c.mp3`)).toBe(String.raw`D:\Music\c.mp3`);
  });
});
