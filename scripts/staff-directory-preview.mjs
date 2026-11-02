/** Owned disposable signed staff UI. Never production or a vendor/live-system adapter. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startStaffPreview } from '../apps/api/dev/staff-preview.mjs';
import { createStaffPreviewShutdown, retireOwnedStaffChild } from './staff-preview-lifecycle.mjs';
const args = process.argv.slice(2),
  allowed = [
    '--lost-results',
    '--agent',
    '--foreign-admin',
    '--second-brand',
    '--memberships',
    '--issue-invitations',
    '--lost-acceptance',
  ];
if (
  process.env.NODE_ENV === 'production' ||
  new Set(args).size !== args.length ||
  args.some((x) => !allowed.includes(x)) ||
  (args.includes('--agent') && args.includes('--foreign-admin')) ||
  (args.includes('--lost-acceptance') && !args.includes('--issue-invitations'))
)
  throw Error('Development staff preview options are invalid.');
if (existsSync(new URL('../apps/admin/.next/dev/lock', import.meta.url)))
  throw Error('Existing admin development directory occupied; preserve it.');
const api = await startStaffPreview({
  port: 0,
  actor: args.includes('--agent')
    ? 'agent'
    : args.includes('--foreign-admin')
      ? 'other-company-admin'
      : 'admin',
  tenantSlug: args.includes('--second-brand') ? 'sample-homes' : 'realtime-estates',
  seedAcceptedMedia: false,
  staffInvitationMode: 'synthetic-capture-only-v1',
  ...(args.includes('--lost-acceptance')
    ? { invitationRedemptionReplyFault: 'invalid-first-redemption-result-v1' }
    : {}),
  ...(args.includes('--issue-invitations')
    ? { staffInvitationRedemptionMode: 'synthetic-single-use-invitations-v1' }
    : {}),
  ...(args.includes('--memberships') || args.includes('--issue-invitations')
    ? {
        staffMembershipMode: 'synthetic-existing-members-v1',
        ...(args.includes('--lost-results')
          ? { membershipReplyFault: 'invalid-first-membership-result-v1' }
          : {}),
      }
    : {}),
  ...(args.includes('--lost-results')
    ? {
        branchReplyFault: 'invalid-first-branch-result-v1',
        invitationReplyFault: 'invalid-first-invitation-results-v1',
      }
    : {}),
});
const input = createInterface({ input: process.stdin, terminal: false });
let view = 'admin';
let child = null,
  queue = Promise.resolve();
const shutdown = createStaffPreviewShutdown({
  closeInput: () => input.close(),
  takeChild: () => {
    const owned = child;
    child = null;
    return owned;
  },
  retireChild: retireOwnedStaffChild,
  closeApi: () => api.close(),
});
const stop = () => shutdown.stop();
function requestStop() {
  void stop().catch(() => {
    process.exitCode = 1;
    console.error('Owned staff preview cleanup could not be fully confirmed.');
  });
}
async function launch() {
  if (shutdown.isStopping()) return;
  const old = child;
  child = null;
  await retireOwnedStaffChild(old);
  if (shutdown.isStopping()) return;
  child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
      'dev',
      'apps/admin',
      '-p',
      '3124',
      '-H',
      '127.0.0.1',
    ],
    {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      stdio: 'inherit',
      windowsHide: true,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        TENANT_SLUG: api.tenantSlug,
        STAFF_PREVIEW_MODE: 'synthetic',
        STAFF_DIRECTORY_PREVIEW_MODE: 'synthetic-v1',
        STAFF_INVITATION_ISSUE_PREVIEW_MODE: args.includes('--issue-invitations')
          ? 'synthetic-single-use-invitations-v1'
          : undefined,
        STAFF_MEMBERSHIP_PREVIEW_MODE:
          args.includes('--memberships') || args.includes('--issue-invitations')
            ? 'synthetic-existing-members-v1'
            : undefined,
        STAFF_PREVIEW_API_ORIGIN: api.origin,
        STAFF_PREVIEW_TOKEN: view === 'recipient' ? undefined : api.bearerToken,
        STAFF_INVITATION_RECIPIENT_PREVIEW_MODE:
          view === 'recipient' ? 'synthetic-verified-recipient-v1' : undefined,
        STAFF_INVITATION_RECIPIENT_TOKEN:
          view === 'recipient' ? api.invitationRecipient.bearerToken : undefined,
        STAFF_PREVIEW_INSTANCE: randomUUID(),
      },
    },
  );
  const owned = child;
  owned.once('error', () => {
    process.exitCode = 1;
    requestStop();
  });
  owned.once('exit', (code) => {
    if (!shutdown.isStopping() && child === owned) {
      process.exitCode = code ?? 1;
      requestStop();
    }
  });
  console.log(
    'Owned staff admin UI pid ' +
      owned.pid +
      (view === 'recipient'
        ? ' at http://127.0.0.1:3124/invitations/accept. Recipient identity only; no admin bearer in this UI process.'
        : ' at http://127.0.0.1:3124/staff. Signed identity stays in child environment.'),
  );
}
input.on('line', (line) => {
  queue = queue
    .then(() =>
      line.trim() === 'quit'
        ? stop()
        : line.trim() === 'restart'
          ? launch()
          : ['recipient', 'admin'].includes(line.trim()) && args.includes('--issue-invitations')
            ? ((view = line.trim()), launch())
            : console.log('Use restart or quit; issuance mode also supports recipient or admin.'),
    )
    .catch(() => {
      process.exitCode = 1;
      requestStop();
    });
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, requestStop);
try {
  await launch();
} catch {
  process.exitCode = 1;
  requestStop();
}
console.log(
  'Synthetic fixtures only: capture and issuance send no email or grant membership; verified recipient acceptance creates synthetic membership. --memberships enables existing-staff changes; --issue-invitations separately enables synthetic one-time issuance and its membership prerequisite, with separate recipient/admin views and no email delivery. --lost-acceptance corrupts the first committed acceptance reply. --lost-results corrupts first committed results. Restart retains owned API/database with a fresh browser instance; quit stops only owned children and fixtures.',
);
