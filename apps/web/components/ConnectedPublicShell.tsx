import { customerBridge } from '../lib/customer-runtime';
import { hostedCustomer } from '../lib/hosted-customer-runtime';
import { PublicHeader, PublicFooter } from './PublicShell.tsx';
import { readApprovedCompany, approvedPresentation } from '../lib/approved-company.ts';
export { CatalogueBanner, CatalogueProblem } from './PublicShell.tsx';
export async function ConnectedPublicHeader(props: Parameters<typeof PublicHeader>[0]) {
  let accounts = false;
  try {
    accounts =
      process.env.HOSTED_CUSTOMER_API_ORIGIN !== undefined
        ? hostedCustomer() !== null
        : customerBridge() !== null;
  } catch {
    /* Setup stays unavailable. */
  }
  return (
    <PublicHeader
      {...props}
      accounts={accounts}
      brand={approvedPresentation(await readApprovedCompany()).brand}
    />
  );
}
export async function ConnectedPublicFooter(props: Parameters<typeof PublicFooter>[0]) {
  return (
    <PublicFooter {...props} brand={approvedPresentation(await readApprovedCompany()).brand} />
  );
}
