import { isDeepStrictEqual } from 'node:util';
import { resolveDemoTenantSlug } from '@realtor/demo';
import { previewApplicationId, propertyLinkOrigin, propertyLinkPathPrefix } from '@realtor/domain';

const listingIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const androidFingerprintPattern = /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/;
const iosTeamPattern = /^[A-Z0-9]{10}$/;

function expectedAssociations(appId, fingerprint, team) {
  const endpoints = [];
  if (fingerprint) {
    endpoints.push([
      '/.well-known/assetlinks.json',
      [
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: {
            namespace: 'android_app',
            package_name: appId,
            sha256_cert_fingerprints: [fingerprint],
          },
        },
      ],
    ]);
  }
  if (team) {
    endpoints.push([
      '/.well-known/apple-app-site-association',
      {
        applinks: {
          details: [
            { appIDs: [team + '.' + appId], components: [{ '/': propertyLinkPathPrefix + '*' }] },
          ],
        },
      },
    ]);
  }
  return endpoints;
}

async function readResponse(fetcher, url, contentType, headers = {}) {
  const response = await fetcher(url, {
    headers,
    credentials: 'omit',
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  const path = new URL(url).pathname;
  if (response.status !== 200 || response.redirected)
    throw Error(path + ' returned HTTP ' + response.status + '; expected a direct 200.');
  const mediaType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (mediaType !== contentType) throw Error(path + ' must return ' + contentType + '.');
  return response;
}

export async function verifyPropertyLinkHost(env, fetcher = globalThis.fetch) {
  const {
    WEB_PUBLIC_ORIGIN: configuredOrigin,
    WEB_APP_LINKS_TEST_LISTING_ID: listing,
    TENANT_SLUG: tenant,
    WEB_APP_LINKS_ANDROID_SHA256: fingerprint,
    WEB_APP_LINKS_IOS_TEAM_ID: team,
  } = env;
  if (!configuredOrigin || !tenant)
    throw Error('Set WEB_PUBLIC_ORIGIN and TENANT_SLUG for the authorized synthetic preview.');
  const { origin } = propertyLinkOrigin(configuredOrigin);
  const appId = previewApplicationId(resolveDemoTenantSlug(tenant));
  if (listing?.length !== 36 || !listingIdPattern.test(listing))
    throw Error('Set WEB_APP_LINKS_TEST_LISTING_ID to an approved synthetic listing UUID.');
  if (!fingerprint && !team) throw Error('Provide at least one public signing identity.');
  if (
    (fingerprint !== undefined && !androidFingerprintPattern.test(fingerprint)) ||
    (team !== undefined && !iosTeamPattern.test(team))
  )
    throw Error('The Android SHA-256 fingerprint or Apple team ID has the wrong format.');

  const checked = [];
  for (const [path, expected] of expectedAssociations(appId, fingerprint, team)) {
    const response = await readResponse(fetcher, origin + path, 'application/json');
    const association = await response.json().catch(() => null);
    if (!isDeepStrictEqual(association, expected))
      throw Error(
        path + ' does not match the expected preview application, signer and route scope.',
      );
    checked.push(path);
  }

  const listingUrl = origin + propertyLinkPathPrefix + listing;
  const fallback = await readResponse(fetcher, listingUrl, 'text/html', {
    'user-agent': 'facebookexternalhit/1.1',
  });
  const html = await fallback.text();
  const canonical = [...html.matchAll(/<link\b[^>]*>/gi)].find(([tag]) =>
    /\srel=["']canonical["']/i.test(tag),
  );
  const href = canonical?.[0].match(/\shref=["']([^"']+)["']/i)?.[1];
  if (href !== listingUrl)
    throw Error('The web fallback did not identify the requested canonical listing.');
  return { origin, appId, checked, listingUrl };
}

if (import.meta.main) {
  try {
    const result = await verifyPropertyLinkHost(process.env);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Property link preflight failed: ' + error.message);
    process.exitCode = 1;
  }
}
