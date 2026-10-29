import { PublicHeader, PublicFooter } from './PublicShell.tsx';
import { readApprovedCompany, approvedPresentation } from '../lib/approved-company.ts';
export { CatalogueBanner, CatalogueProblem } from './PublicShell.tsx';
export async function ConnectedPublicHeader(props: Parameters<typeof PublicHeader>[0]) {
  return (
    <PublicHeader {...props} brand={approvedPresentation(await readApprovedCompany()).brand} />
  );
}
export async function ConnectedPublicFooter(props: Parameters<typeof PublicFooter>[0]) {
  return (
    <PublicFooter {...props} brand={approvedPresentation(await readApprovedCompany()).brand} />
  );
}
