import { registerHooks, syncBuiltinESMExports } from 'node:module';
import https from 'node:https';
import { appendFileSync } from 'node:fs';
import assert from 'node:assert/strict';
// Explicit child-process test preload, never imported by application code or shipped in runtime trees.
assert.equal(process.env.REALTOR_NATIVE_SMOKE_POLICY, 'owned-loopback-synthetic-v1');
const project = 'realtor-synthetic-staging';
const target = 'https://synthetic-api-123456.us-central1.run.app';
const address = new URL(process.env.REALTOR_NATIVE_SMOKE_PRIVATE_URL);
assert.equal(address.hostname, '127.0.0.1');
assert.equal(address.protocol, 'http:');
const telemetry = process.env.REALTOR_NATIVE_SMOKE_TELEMETRY;
const record = (event) => appendFileSync(telemetry, JSON.stringify(event) + '\n');
record({ kind: 'preload' });
const auth = `exports.getAuth=()=>({verifyIdToken:async(token,revoked)=>{
 if(revoked!==true)throw Error('Revocation check required');
 globalThis.__nativeSmokeRecord({kind:'firebase',token});
 if(token==='revoked.user.signature')throw Error('Synthetic revoked identity');
 const now=Math.floor(Date.now()/1000);
 return {uid:'synthetic-customer',sub:'synthetic-customer',aud:'${project}',iss:'https://securetoken.google.com/${project}',iat:now,auth_time:now,exp:now+3600,email:'synthetic@example.invalid',email_verified:token!=='unverified.user.signature',firebase:{sign_in_provider:'password'}};
}});`;
const iam = `exports.GoogleAuth=class{async getIdTokenClient(audience){
 if(audience!=='${target}')throw Error('Foreign audience');
 return {getRequestHeaders:async()=>{globalThis.__nativeSmokeRecord({kind:'iam'});return new Headers({Authorization:'Bearer synthetic.service.signature'});}};
}};`;
globalThis.__nativeSmokeRecord = record;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'firebase-admin/auth' || specifier === 'google-auth-library')
      return { url: 'synthetic-native-smoke:' + specifier, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (
      url.startsWith('synthetic-native-smoke:') ||
      /\/firebase-admin\/lib\/auth\/index\.js$/.test(url) ||
      /\/google-auth-library\/build\/src\/index\.js$/.test(url)
    )
      return {
        format: 'commonjs',
        source:
          url.endsWith('firebase-admin/auth') || /\/firebase-admin\/lib\/auth\/index\.js$/.test(url)
            ? auth
            : iam,
        shortCircuit: true,
      };
    return next(url, context);
  },
});
https.request = https.get = () => {
  throw Error('External HTTPS forbidden in owned synthetic fixture');
};
syncBuiltinESMExports();
const actual = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init),
    url = new URL(request.url);
  assert.equal(url.origin, target, 'External network refused by synthetic gateway fixture');
  assert.equal(
    request.headers.get('x-serverless-authorization'),
    'Bearer synthetic.service.signature',
  );
  assert.equal(request.headers.get('authorization'), 'Bearer valid.user.signature');
  record({ kind: 'private', method: request.method, path: url.pathname });
  const response = await actual(address.origin + url.pathname + url.search, {
    method: request.method,
    headers: request.headers,
    signal: request.signal,
    redirect: 'error',
    ...(request.method === 'POST' ? { body: await request.text() } : {}),
  });
  // Only this owned-loopback fixture maps declared HTTPS metadata; no TLS proof is asserted.
  Object.defineProperty(response, 'url', { value: request.url });
  return response;
};
