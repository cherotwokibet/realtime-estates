# Synthetic local recovery custody

Checkpoint 489 adds opt-in Windows CurrentUser DPAPI custody for an independently generated recovery key and three distinct preview profile instances. It is limited to synthetic local development. Production refuses this mode. Firebase/Cloud Run, Linux managed custody, rotation and retirement are not implemented here; billing remains disabled.

The default remains disposable RAM-only custody. Only the enquiry/pilot launcher supports this opt-in. Other existing launchers reject custody configuration instead of silently substituting a random key. No real owner bundle has been initialized or configured by this checkpoint, and no existing plaintext original has been migrated or deleted.

## Operator setup

Use an existing owner-controlled directory outside the entire RealEstate workspace and source checkouts. Parent directories are not created automatically. Windows file mode 0600 is requested, but Windows ACL validation is not established by these tests. Review directory permissions separately before retaining sensitive material.

In PowerShell, set the mode and initialize a new file, replacing the example path with an absolute path in that existing directory:

```powershell
$env:PRIVATE_RECOVERY_CUSTODY_MODE = 'synthetic-windows-owner-v1'
node scripts/private-recovery-custody.mjs init --file 'C:\OwnerControlledDirectory\recovery-custody.json' --tenant realtime-estates
```

The command prints non-secret metadata, including a custody ID. Save that ID as the explicit expected identity; do not infer it from an untrusted replacement file. The key is never printed, supplied as a command-line argument or written as plaintext. The encrypted file is exclusive-create and readback verified; an existing file is never overwritten. If creation fails, preserve and investigate any newly created partial file instead of treating it as valid or replacing it silently.

Verify the file using its recorded ID:

```powershell
node scripts/private-recovery-custody.mjs check --file 'C:\OwnerControlledDirectory\recovery-custody.json' --tenant realtime-estates --custody-id 'RECORDED-CUSTODY-UUID'
```

For the existing synthetic enquiry/pilot launcher, set all three custody fields together:

```powershell
$env:PRIVATE_RECOVERY_CUSTODY_FILE = 'C:\OwnerControlledDirectory\recovery-custody.json'
$env:PRIVATE_RECOVERY_CUSTODY_ID = 'RECORDED-CUSTODY-UUID'
$env:TENANT_SLUG = 'realtime-estates'
npm run dev:enquiry-preview
```

Do not also set PRIVATE_RECOVERY_MODE or PRIVATE_RECOVERY_STORAGE_KEY. Partial configuration, wrong tenant/ID, missing, corrupt, oversized or noncanonical data and incompatible protection fail before service startup. They never create replacement custody. Public web children strip all PRIVATE_RECOVERY_ fields; the private admin child receives the recovery environment as before. Do not log that environment or enumerate sensitive object properties explicitly.

## What verification establishes

The focused tests create only disposable synthetic fixtures. Real Windows DPAPI checks cover wrap/readback, corruption refusal, CLI metadata output, overwrite refusal and production refusal. A separate-process test seals a typed original through the signed API/BFF, copies the protected bundle, and opens that capsule in another Node process using fresh signed authority. A changed role is denied even with the same valid key. A wrong custody ID refuses before authority starts. Cross-platform tests use an explicitly labelled disposable test protection provider and do not claim DPAPI acceptance on Linux.

The file contains an encrypted key bundle, not an application database backup. A same-owner copied-file test does not prove recovery on another host or Windows profile. Retain the Windows user-profile/DPAPI recovery dependency; no cross-user or off-host restoration is claimed. Temporary buffers are cleared where practical; JavaScript string/heap zeroization is not guaranteed.

Complete application cold restart, persistent SQL outcomes/ledger recovery, browser closed-tab recovery, storage migration, permission review, key rotation and retirement remain open. Do not delete a retained original merely because this custody primitive can reopen its capsule. Typed migration must first prove the complete application recovery path under fresh current actor/tenant/resource authority, preserve uncertain outcomes and verify readback before any eligible plaintext copy is removed.
