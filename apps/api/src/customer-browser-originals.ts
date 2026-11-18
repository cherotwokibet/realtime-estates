import { validateCustomerFavouriteCommand, type CustomerFavouriteCommand } from '@realtor/domain';
import type { IdentityStateDatabase } from './browser-identity-store.js';
import { createBrowserOriginals, type BrowserOriginals } from './browser-originals.js';
export type { OriginalScope } from './browser-originals.js';
export type CustomerOriginals = BrowserOriginals<CustomerFavouriteCommand>;
export function createCustomerOriginals(
  db: IdentityStateDatabase,
  encryptionKey: string,
): CustomerOriginals {
  return createBrowserOriginals(
    db,
    encryptionKey,
    'customer_browser_originals',
    validateCustomerFavouriteCommand,
  );
}
