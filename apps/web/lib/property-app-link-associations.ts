import { propertyLinkOrigin, propertyLinkPathPrefix, previewApplicationId } from '@realtor/domain';
import { resolveDemoTenantSlug } from '@realtor/demo';

export function readPropertyAssociation(
  platform: 'android' | 'ios',
  env: Readonly<Record<string, string | undefined>>,
): Response {
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  const unavailable = () => new Response(null, { status: 404, headers });
  if (env.WEB_APP_LINKS_MODE !== 'synthetic-v1' || !env.WEB_PUBLIC_ORIGIN || !env.TENANT_SLUG)
    return unavailable();

  try {
    propertyLinkOrigin(env.WEB_PUBLIC_ORIGIN);
    const appId = previewApplicationId(resolveDemoTenantSlug(env.TENANT_SLUG));
    if (platform === 'android') {
      const fingerprint = env.WEB_APP_LINKS_ANDROID_SHA256;
      if (!fingerprint || !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fingerprint))
        return unavailable();
      return Response.json(
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
        { headers },
      );
    }

    const teamId = env.WEB_APP_LINKS_IOS_TEAM_ID;
    if (!teamId || !/^[A-Z0-9]{10}$/.test(teamId)) return unavailable();
    return Response.json(
      {
        applinks: {
          details: [
            { appIDs: [teamId + '.' + appId], components: [{ '/': propertyLinkPathPrefix + '*' }] },
          ],
        },
      },
      { headers },
    );
  } catch {
    return unavailable();
  }
}
