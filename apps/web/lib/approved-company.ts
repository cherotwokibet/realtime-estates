import {
  brandThemeCss,
  parseCompanySettingsJson,
  validateCompanySettingsContent,
  type CompanySettingsContent,
} from '@realtor/domain';
import { publicCompanyInfo, type PublicCompanyInfo } from './public-company.ts';
import { tenantBrand, tenantThemeCss } from './tenant.ts';
import { cache } from 'react';
type Env = Readonly<Record<string, string | undefined>>;
type Result = {
  status: 'absent' | 'ready' | 'unavailable';
  content: CompanySettingsContent | null;
};
const IDS: Readonly<Record<string, string>> = {
  'realtime-estates': '00000000-0000-4000-8000-000000000001',
  'sample-homes': '00000000-0000-4000-8000-000000000002',
};
/** Explicit synthetic connected preview only. No caller URL, cookies, identity or authority forwarded. */
async function readApprovedCompanyUncached(
  env: Env = process.env,
  fetcher: typeof fetch = fetch,
): Promise<Result> {
  if (env.WEB_COMPANY_SETTINGS_MODE === undefined && env.WEB_COMPANY_SETTINGS_ORIGIN === undefined)
    return { status: 'absent', content: null };
  let response: Response | undefined;
  try {
    if (env.NODE_ENV !== 'development' || env.WEB_COMPANY_SETTINGS_MODE !== 'synthetic-v1')
      throw Error('Development boundary.');
    const expected = IDS[env.TENANT_SLUG ?? 'realtime-estates'];
    if (!expected) throw Error('Configured company required.');
    const origin = new URL(env.WEB_COMPANY_SETTINGS_ORIGIN ?? '');
    if (
      origin.protocol !== 'http:' ||
      origin.hostname !== '127.0.0.1' ||
      !origin.port ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash ||
      origin.username ||
      origin.password
    )
      throw Error('Fixed loopback origin required.');
    const deadline = AbortSignal.timeout(5000);
    response = await fetcher(origin.origin + '/v2/public/company-settings', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: deadline,
    });
    if (
      !response.ok ||
      response.headers.get('content-type')?.split(';')[0] !== 'application/json' ||
      !response.body
    )
      throw Error('Invalid public settings response.');
    const reader = response.body.getReader();
    let source = '',
      bytes = 0;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 32 * 1024) throw Error('Public settings too large.');
        source += decoder.decode(value, { stream: true });
      }
      source += decoder.decode();
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const value = parseCompanySettingsJson(source);
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'content,policy,tenantId'
    )
      throw Error('Invalid public projection.');
    const row = value as Record<string, unknown>;
    if (row.policy !== 'public-company-settings-v1' || row.tenantId !== expected)
      throw Error('Company projection mismatch.');
    return {
      status: 'ready',
      content: row.content === null ? null : validateCompanySettingsContent(row.content),
    };
  } catch {
    await response?.body?.cancel().catch(() => {});
    return { status: 'unavailable', content: null };
  }
}
/** React memoization lasts for the current server render, never across requests or company sessions. */
export const readApprovedCompany = cache(readApprovedCompanyUncached);
export function approvedPresentation(result: Result) {
  const c = result.status === 'ready' ? result.content : null;
  return c
    ? {
        brand: {
          name: c.companyName,
          primary: c.colors.primary,
          accent: c.colors.accent,
          initials: c.companyName
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0])
            .join('')
            .toUpperCase(),
        },
        css: brandThemeCss(c.colors),
      }
    : { brand: tenantBrand, css: tenantThemeCss };
}
/** Approved copy may change public information; configured contact/advisor permissions stay intact. */
export function approvedCompanyInfo(result: Result, env: Env = process.env): PublicCompanyInfo {
  const base = publicCompanyInfo(env);
  if (result.status === 'absent') return base;
  if (result.status === 'unavailable')
    return { ...base, contentStatus: 'invalid', content: null, advisors: [], advisor: null };
  if (!result.content)
    return { ...base, contentStatus: 'absent', content: null, advisors: [], advisor: null };
  const c = result.content;
  const advisors = base.content ? base.advisors : [];
  return {
    ...base,
    name: c.companyName,
    advisors,
    advisor: advisors[0] ?? null,
    contentStatus: 'configured',
    content: {
      policy: 'public-company-content-v1',
      companySlug: base.slug,
      company: {
        summary: c.summary,
        about: c.about,
        ...(c.officeAddress ? { officeAddress: c.officeAddress } : {}),
        ...(c.openingHours ? { openingHours: c.openingHours } : {}),
      },
      advisors: base.content?.advisors ?? [],
      ...(base.content?.contact ? { contact: base.content.contact } : {}),
    },
  };
}
