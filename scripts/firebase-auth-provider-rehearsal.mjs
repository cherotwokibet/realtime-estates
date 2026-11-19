import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const project = 'boniface-realtor-staging';
const apps = [
  '1:144079064698:web:89f61d2a4a0fb52d8675c3',
  '1:144079064698:web:7b448ab47043f0758675c3',
];
class RehearsalError extends Error {
  constructor(stage, code, definitive = false) {
    super('Owned provider rehearsal failed.');
    this.stage = stage;
    this.code = code;
    this.definitive = definitive;
  }
}
const insist = (condition, stage, code) => {
  if (!condition) throw new RehearsalError(stage, code);
};
function preflight(input, live) {
  insist(
    input?.policy === 'owned-staging-auth-public-rest-v1',
    'preflight',
    'EXPLICIT_POLICY_REQUIRED',
  );
  insist(input.billingEnabled === false, 'preflight', 'BILLING_MUST_BE_DISABLED');
  insist(
    Number.isFinite(Date.parse(input.billingCheckedAt)) &&
      Date.now() - Date.parse(input.billingCheckedAt) >= -5000 &&
      Date.now() - Date.parse(input.billingCheckedAt) <= 600000,
    'preflight',
    'FRESH_BILLING_READBACK_REQUIRED',
  );
  const c = input.sdkConfig;
  insist(
    c?.projectId === project &&
      apps.includes(c.appId) &&
      c.authDomain === project + '.firebaseapp.com' &&
      String(c.projectNumber) === '144079064698',
    'preflight',
    'OWNED_PROJECT_CONFIG_REQUIRED',
  );
  insist(/^AIza[A-Za-z0-9_-]{35}$/.test(c.apiKey), 'preflight', 'VALID_PUBLIC_SDK_KEY_REQUIRED');
  insist(
    process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' && !process.env.FIREBASE_AUTH_EMULATOR_HOST,
    'preflight',
    'REAL_VERIFIED_PROVIDER_REQUIRED',
  );
  insist(
    !live || process.env.GITHUB_ACTIONS !== 'true',
    'preflight',
    'MANUAL_PROVIDER_REHEARSAL_ONLY',
  );
  return c;
}
/** Bounded public APIs only. No admin credential, mailbox verification, email/SMS or backend acceptance. */
export async function runFirebaseAuthProviderRehearsal(input, dependencies = {}) {
  const live = !dependencies.fetch && !dependencies.verifyToken;
  const config = preflight(input, live);
  const fetcher = dependencies.fetch ?? fetch;
  const email = 'realtor-rebuild-ci-' + randomBytes(12).toString('hex') + '@example.invalid';
  const password = 'Rr!' + randomBytes(32).toString('base64url') + '7a';
  const checks = {
    signup: false,
    passwordSignIn: false,
    signedProjectClaims: false,
    selfLookup: false,
    refresh: false,
    selfDeletion: false,
    absenceAfterDeletion: false,
    deletedRefreshRefused: false,
  };
  let uid,
    idToken,
    refreshToken,
    app,
    creationMayExist = false,
    deleted = false,
    requests = 0,
    error;
  const report = {
    projectId: project,
    appId: config.appId,
    transport: live ? 'live-provider' : 'injected-test-only',
    startedAt: new Date().toISOString(),
    checks,
    backendVerifiedEmailAccepted: false,
    backendRevocationChecked: false,
    cloudRunAdcVerified: false,
    billingChanged: false,
    emailsOrSmsSent: 0,
  };
  async function post(stage, method, data) {
    insist(++requests <= 14, stage, 'REQUEST_BUDGET_EXHAUSTED');
    const refresh = method === 'refresh';
    const endpoint = refresh
      ? 'https://securetoken.googleapis.com/v1/token'
      : 'https://identitytoolkit.googleapis.com/v1/accounts:' + method;
    insist(
      ['signUp', 'signInWithPassword', 'lookup', 'delete', 'refresh'].includes(method),
      stage,
      'ENDPOINT_REFUSED',
    );
    let response, body;
    try {
      response = await fetcher(endpoint + '?key=' + encodeURIComponent(config.apiKey), {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: {
          'Content-Type': refresh ? 'application/x-www-form-urlencoded' : 'application/json',
        },
        body: refresh ? new URLSearchParams(data).toString() : JSON.stringify(data),
      });
      const text = await response.text();
      insist(text.length < 32768, stage, 'PROVIDER_RESPONSE_TOO_LARGE');
      body = JSON.parse(text);
    } catch (e) {
      if (e instanceof RehearsalError) throw e;
      throw new RehearsalError(stage, 'NETWORK_OR_RESPONSE_ERROR');
    }
    if (!response.ok) {
      const message =
        typeof body?.error?.message === 'string'
          ? body.error.message
          : typeof body?.error === 'string'
            ? body.error
            : '';
      const code = message.match(/^([A-Z][A-Z0-9_]{1,79})(?:\s|:|$)/)?.[1] ?? 'PROVIDER_ERROR';
      throw new RehearsalError(stage, code, response.status >= 400 && response.status < 500);
    }
    return body;
  }
  function remember(result) {
    insist(
      typeof result.localId === 'string' && /^[A-Za-z0-9_-]{20,128}$/.test(result.localId),
      'identity',
      'VALID_UID_REQUIRED',
    );
    insist(
      result.email === email && (!uid || uid === result.localId),
      'identity',
      'OWNERSHIP_MISMATCH',
    );
    insist(
      typeof result.idToken === 'string' &&
        result.idToken.length < 8192 &&
        typeof result.refreshToken === 'string' &&
        result.refreshToken.length < 8192,
      'identity',
      'TOKENS_REQUIRED',
    );
    uid = result.localId;
    idToken = result.idToken;
    refreshToken = result.refreshToken;
  }
  async function verify(token) {
    let decoded;
    try {
      if (dependencies.verifyToken) decoded = await dependencies.verifyToken(token, project);
      else {
        app ??= initializeApp({ projectId: project }, 'realtor-auth-rehearsal-' + randomUUID());
        // Public signature/claims only. Production continues to require verifyIdToken(token,true).
        decoded = await getAuth(app).verifyIdToken(token, false);
      }
    } catch {
      throw new RehearsalError('signature', 'SIGNATURE_VERIFICATION_FAILED');
    }
    insist(
      decoded?.aud === project &&
        decoded.iss === 'https://securetoken.google.com/' + project &&
        decoded.uid === uid &&
        decoded.sub === uid &&
        decoded.email === email &&
        decoded.firebase?.sign_in_provider === 'password',
      'signature',
      'PROJECT_OR_SUBJECT_MISMATCH',
    );
    insist(
      Number.isSafeInteger(decoded.exp) &&
        Number.isSafeInteger(decoded.iat) &&
        decoded.exp > Math.floor(Date.now() / 1000) &&
        decoded.exp > decoded.iat &&
        decoded.exp - decoded.iat <= 3600,
      'signature',
      'INVALID_TOKEN_TIME',
    );
    insist(decoded.email_verified === false, 'signature', 'EXPECTED_UNVERIFIED_SYNTHETIC_ACCOUNT');
    checks.signedProjectClaims = true;
  }
  async function ownedLookup() {
    const r = await post('lookup', 'lookup', { idToken });
    insist(
      Array.isArray(r.users) &&
        r.users.length === 1 &&
        r.users[0].localId === uid &&
        r.users[0].email === email,
      'lookup',
      'OWNERSHIP_MISMATCH',
    );
    return r.users[0];
  }
  async function confirmAbsent() {
    try {
      const r = await post('deleted-lookup', 'lookup', { idToken });
      insist(
        Array.isArray(r.users) && r.users.length === 0,
        'deleted-lookup',
        'ACCOUNT_STILL_PRESENT',
      );
    } catch (e) {
      if (!['USER_NOT_FOUND', 'INVALID_ID_TOKEN'].includes(e.code)) throw e;
    }
    checks.absenceAfterDeletion = true;
  }
  async function removeOwned() {
    await ownedLookup(); // Never delete a different account or a supplied arbitrary token.
    await post('delete', 'delete', { idToken });
    deleted = true;
    checks.selfDeletion = true;
    await confirmAbsent();
  }
  try {
    creationMayExist = true;
    let signup;
    try {
      signup = await post('signup', 'signUp', { email, password, returnSecureToken: true });
    } catch (e) {
      if (e.definitive) creationMayExist = false;
      throw e;
    }
    remember(signup);
    checks.signup = true;
    await verify(idToken);
    remember(
      await post('sign-in', 'signInWithPassword', { email, password, returnSecureToken: true }),
    );
    checks.passwordSignIn = true;
    await verify(idToken);
    await ownedLookup();
    checks.selfLookup = true;
    const fresh = await post('refresh', 'refresh', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    insist(
      fresh.user_id === uid &&
        [project, '144079064698'].includes(String(fresh.project_id)) &&
        typeof fresh.id_token === 'string' &&
        typeof fresh.refresh_token === 'string',
      'refresh',
      'REFRESH_SUBJECT_MISMATCH',
    );
    idToken = fresh.id_token;
    refreshToken = fresh.refresh_token;
    await verify(idToken);
    checks.refresh = true;
    await removeOwned();
    try {
      await post('deleted-refresh', 'refresh', {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });
      throw new RehearsalError('deleted-refresh', 'DELETED_REFRESH_ACCEPTED');
    } catch (e) {
      insist(
        ['TOKEN_EXPIRED', 'USER_NOT_FOUND', 'INVALID_REFRESH_TOKEN'].includes(e.code),
        'deleted-refresh',
        e.code ?? 'UNEXPECTED_REFRESH_RESPONSE',
      );
      checks.deletedRefreshRefused = true;
    }
  } catch (e) {
    error = {
      stage: e instanceof RehearsalError ? e.stage : 'rehearsal',
      code: e instanceof RehearsalError ? e.code : 'UNEXPECTED_REHEARSAL_FAILURE',
    };
  } finally {
    if (creationMayExist && !deleted) {
      try {
        if (!idToken)
          remember(
            await post('cleanup-recover', 'signInWithPassword', {
              email,
              password,
              returnSecureToken: true,
            }),
          );
        await removeOwned();
      } catch (e) {
        report.cleanupFailure = {
          stage: e instanceof RehearsalError ? e.stage : 'cleanup',
          code: e instanceof RehearsalError ? e.code : 'CLEANUP_FAILED',
        };
        report.syntheticEmailForManualCleanup = email;
      }
    }
    if (app) await deleteApp(app).catch(() => {});
  }
  report.requestCount = requests;
  report.accountCreationRequests = 1;
  report.cleanupCompleted = !creationMayExist || (deleted && checks.absenceAfterDeletion);
  report.cleanupRequired = creationMayExist && !report.cleanupCompleted;
  if (uid) report.syntheticUidSha256 = createHash('sha256').update(uid).digest('hex');
  report.finishedAt = new Date().toISOString();
  report.status =
    !error && Object.values(checks).every(Boolean) && report.cleanupCompleted ? 'passed' : 'failed';
  report.livePublicProviderLifecycleVerified = live && report.status === 'passed';
  if (error) report.error = error;
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let input = '';
  try {
    insist(
      process.argv.length === 3 && process.argv[2] === '--owned-staging-auth-rehearsal',
      'preflight',
      'EXPLICIT_MANUAL_FLAG_REQUIRED',
    );
    for await (const chunk of process.stdin) {
      input += chunk;
      insist(input.length < 16384, 'preflight', 'INPUT_TOO_LARGE');
    }
    const result = await runFirebaseAuthProviderRehearsal(JSON.parse(input));
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'passed') process.exitCode = 1;
  } catch (e) {
    console.log(
      JSON.stringify({
        status: 'failed',
        livePublicProviderLifecycleVerified: false,
        error: {
          stage: e instanceof RehearsalError ? e.stage : 'preflight',
          code: e instanceof RehearsalError ? e.code : 'INVALID_REHEARSAL_INPUT',
        },
      }),
    );
    process.exitCode = 1;
  }
}
