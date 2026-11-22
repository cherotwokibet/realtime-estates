# Owned local settings recovery rehearsal

This maintained launcher runs the existing Next settings page/BFF and a signed loopback API backed by a disposable file-backed PGlite ledger. It is for independently authored synthetic local work. It refuses production and supports only marked physical directories created in OS temporary storage; it is not the hosted database adapter. The normal staff/enquiry preview launcher remains ephemeral.

The CLI uses Windows CurrentUser DPAPI and requires the current Windows owner profile. Linux CI calls the same launcher API with explicitly labelled disposable wrapping, unavailable through CLI flags. No real Firebase/provider credentials, customers or existing database are used. Keep billing disabled.

## Start a new explicit disposable session

Build the maintained dependencies/API/admin, then run from the relocated platform directory:

```powershell
npm run build:packages
npm run build --workspace=@realtor/api
npm run build --workspace=@realtor/admin
node scripts/settings-recovery-preview.mjs --mode owned-settings-rehearsal-v1 --initialize new-disposable-v1 --port 3001
```

The launcher prints the owned root, protected custody-file path, non-secret custody ID and loopback origin. Keep these together for reopening this synthetic session; never print the recovery key or server bearer. Existing directories cannot be reinitialized. Parent directories or missing ledgers are not silently repaired/replaced. If initialization fails, preserve any partial owned temporary directory for inspection rather than treating it as accepted custody.

Visit the printed origin's `/settings` page. In the terminal use `restart` to stop the Next child, gracefully close SQL/API/JWKS and reopen the same owned data with fresh signed authority and stable profile instance. Use `stop` to close the session; the marked directory remains available for an explicit later reopen. Ctrl+C performs cleanup of the running owned services. Windows terminates the Next child process; the SQL/API close is awaited. No crash or power-loss consistency is claimed.

To reopen after stopping, pass the exact recorded values and the same port when preserving an open browser tab:

```powershell
node scripts/settings-recovery-preview.mjs --mode owned-settings-rehearsal-v1 --root 'RECORDED-ABSOLUTE-ROOT' --file 'RECORDED-ABSOLUTE-CUSTODY-FILE' --custody-id 'RECORDED-CUSTODY-UUID' --port 3001
```

Same-tab sessionStorage can survive reload and server process restart at the same origin. Closing the tab may remove its retained capsule. OS temporary storage is not durable backup; DPAPI depends on the Windows profile. Do not migrate or delete existing originals on the basis of this rehearsal. Hosted/network PostgreSQL custody, backup restore, off-host/cross-user recovery, rotation/retirement, Windows ACL and native-device checks remain open.

## Verified browser path

`node scripts/verify-settings-recovery-browser.mjs` creates its own marked synthetic directory and fresh Chromium profile, uses the maintained launcher through owned child-process IPC, and never intercepts network responses. It deliberately corrupts one successful settings reply after commit, verifies ciphertext-only sessionStorage, gracefully replaces the entire API launcher and Next processes, reloads the same browser tab, refuses current SQL-role loss, restores current admin authority, inspects the exact original receipt and verifies release with one ledger record and no recovery POST. The failed first harness attempt is retained; exact current proof is in the dated restart491 evidence. This is not a closed-tab, crash or production/provider acceptance claim.
