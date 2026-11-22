/** Owned IPC worker for replacing the entire local API/Next launcher process. No secret output. */
import { startSettingsRecoveryPreview } from '../../../../scripts/settings-recovery-preview.mjs';
import { ledgerTestProtection } from './recovery-ledger-protection.mjs';
let preview,
  queue = Promise.resolve();
process.on('message', (message) => {
  queue = queue.then(async () => {
    const { id, action } = message;
    try {
      let value;
      if (action === 'start' && !preview) {
        const { testWrappingKey, ...options } = message.options;
        preview = await startSettingsRecoveryPreview({
          ...options,
          custodyOptions: ledgerTestProtection(testWrappingKey),
        });
        value = { ...preview.current, launcherPid: process.pid };
      } else if (action === 'inspect' && preview)
        value = { ...(await preview.inspect()), writes: preview.writes() };
      else if (action === 'refuse-control' && preview) {
        let refused = false;
        try {
          await preview.restart({ root: message.root });
        } catch {
          refused = true;
        }
        value = { refused, nextPid: preview.current.nextPid };
      } else if (action === 'close') {
        await preview?.close();
        preview = null;
        value = { closed: true };
      } else throw Error('Unsupported owned IPC command.');
      process.send({ id, ok: true, value });
    } catch {
      process.send({ id, ok: false, error: 'OWNED_REHEARSAL_WORKER_UNAVAILABLE' });
    }
  });
});
process.once('disconnect', () => {
  void queue.finally(() => preview?.close());
});
