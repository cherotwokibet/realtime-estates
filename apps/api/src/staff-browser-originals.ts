import { validateStaffBranchCommand, type StaffBranchCommand } from '@realtor/domain';
import type { IdentityStateDatabase } from './browser-identity-store.js';
import { createBrowserOriginals, type BrowserOriginals } from './browser-originals.js';
export type StaffOriginals = BrowserOriginals<StaffBranchCommand>;
export function createStaffOriginals(
  db: IdentityStateDatabase,
  encryptionKey: string,
): StaffOriginals {
  return createBrowserOriginals(
    db,
    encryptionKey,
    'staff_browser_originals',
    validateStaffBranchCommand,
  );
}
