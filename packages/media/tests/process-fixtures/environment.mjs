// Deliberately report presence booleans only, never parent environment values.
import { writeFileSync } from 'node:fs';
const denied = ['REALTOR_SYNTHETIC_SECRET_SENTINEL', 'NODE_OPTIONS', 'NODE_PATH', 'DATABASE_URL', 'AWS_SECRET_ACCESS_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'SYSTEMDRIVE', 'USERDOMAIN', 'USERNAME'];
const allowed = new Set(['systemroot', 'windir', 'path', 'temp', 'tmp', 'uv_threadpool_size']);
writeFileSync('environment.json', JSON.stringify({
  present: Object.fromEntries(denied.map(name => [name, Object.hasOwn(process.env, name)])),
  unexpectedNames: Object.keys(process.env).filter(name => !allowed.has(name.toLowerCase())).sort(),
  tempMatchesAttempt: process.env.TEMP === process.cwd(),
  tmpMatchesAttempt: process.env.TMP === process.cwd(),
  uvThreads: process.env.UV_THREADPOOL_SIZE,
  arguments: process.argv.slice(2),
}), { flag: 'wx' });
