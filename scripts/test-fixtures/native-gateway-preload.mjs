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
const app = `exports.getApps=()=>[];exports.applicationDefault=()=>({getAccessToken:async()=>{throw Error('Real credentials unavailable in synthetic fixture');}});exports.initializeApp=(options,name)=>({options,name});`;
const iam = `exports.GoogleAuth=class{async getIdTokenClient(audience){
 if(audience!=='${target}')throw Error('Foreign audience');
 return {getRequestHeaders:async()=>{globalThis.__nativeSmokeRecord({kind:'iam'});return new Headers({Authorization:'Bearer synthetic.service.signature'});}};
}};`;
globalThis.__nativeSmokeRecord = record;
registerHooks({
  resolve(specifier, context, next) {
    // Next standalone assigns deterministic hashed aliases to external SDK packages.
    const firebase = /^firebase-admin(?:-[a-f0-9]{16})?\/(auth|app)$/.exec(specifier);
    if (firebase)
      return { url: 'synthetic-native-smoke:firebase-admin/' + firebase[1], shortCircuit: true };
    if (/^google-auth-library(?:-[a-f0-9]{16})?$/.test(specifier))
      return { url: 'synthetic-native-smoke:google-auth-library', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (
      url.startsWith('synthetic-native-smoke:') ||
      /\/firebase-admin(?:-[a-f0-9]{16})?\/lib\/(auth|app)\/index\.js$/.test(url) ||
      /\/google-auth-library(?:-[a-f0-9]{16})?\/build\/src\/index\.js$/.test(url)
    )
      return {
        format: 'commonjs',
        source:
          url.endsWith('firebase-admin/auth') ||
          /\/firebase-admin(?:-[a-f0-9]{16})?\/lib\/auth\/index\.js$/.test(url)
            ? auth
            : url.endsWith('firebase-admin/app') ||
                /\/firebase-admin(?:-[a-f0-9]{16})?\/lib\/app\/index\.js$/.test(url)
              ? app
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
