import { CatalogueBanner, PublicFooter, PublicHeader } from '../../components/PublicShell';
import { CompanyContent } from '../../components/PublicCompanyContent';
import { publicCompanyInfo } from '../../lib/public-company';

export const dynamic = 'force-dynamic';
export default function Company() {
  const info = publicCompanyInfo(process.env);
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
