import { lstat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';

/** Development launcher values only; no tenant or identity authority comes from a UI port. */
export function enquiryLaunchConfiguration(env, args = []) {
  if (env.NODE_ENV === 'production') throw Error('Enquiry preview refuses production.');
  const uiPort = env.ENQUIRY_UI_PORT ?? '3001';
  if (
    typeof uiPort !== 'string' ||
    !/^[1-9]\d{3,4}$/.test(uiPort) ||
    Number(uiPort) < 1024 ||
    Number(uiPort) > 65535
  )
    throw Error('Choose an enquiry UI port from 1024 to 65535.');
  const apiPort = env.ENQUIRY_API_PORT ?? '4101';
  if (
    typeof apiPort !== 'string' ||
    (apiPort !== '0' &&
      (!/^[1-9]\d{3,4}$/.test(apiPort) || Number(apiPort) < 1024 || Number(apiPort) > 65535))
  )
    throw Error('Choose an enquiry API port of 0 or from 1024 to 65535.');
  const webPort = args.includes('--web') ? '3002' : undefined;
  if (uiPort === webPort || apiPort === uiPort || apiPort === webPort)
    throw Error('Enquiry API, admin and public web ports must be separate.');
  return Object.freeze({ uiPort, apiPort, webPort });
}

/** Fail before API seeding; probes release their own sockets and never stop another process. */
export async function assertEnquiryLaunchAvailable(config, root) {
  const apps = config.webPort ? ['admin', 'web'] : ['admin'];
  for (const app of apps) {
    let locked = true;
    try {
      await lstat(join(root, 'apps', app, '.next', 'dev', 'lock'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      locked = false;
    }
    if (locked) throw Error(`Enquiry preview requires an unoccupied ${app} development directory.`);
  }
  for (const port of [config.uiPort, config.webPort, config.apiPort].filter(
    (port) => port !== undefined && port !== '0',
  )) {
    const probe = createServer();
    await new Promise((resolve, reject) => {
      probe.once('error', () => reject(Error('An enquiry UI port is unavailable.')));
      probe.listen({ host: '127.0.0.1', port: Number(port), exclusive: true }, () => {
        probe.close((error) => (error ? reject(error) : resolve()));
      });
    });
  }
}
