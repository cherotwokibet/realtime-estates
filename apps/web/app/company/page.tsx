import {
  CatalogueBanner,
  ConnectedPublicFooter as PublicFooter,
  ConnectedPublicHeader as PublicHeader,
} from '../../components/ConnectedPublicShell';
import { CompanyContent } from '../../components/PublicCompanyContent';
import { approvedCompanyInfo, readApprovedCompany } from '../../lib/approved-company';

export const dynamic = 'force-dynamic';
export default async function Company() {
  const info = approvedCompanyInfo(await readApprovedCompany());
  return (
    <>
      <CatalogueBanner mode={info.mode} />
      <PublicHeader current="company" />
      <main id="main" className="container public-info-page">
        <CompanyContent info={info} />
      </main>
      <PublicFooter mode={info.mode} />
    </>
  );
}
