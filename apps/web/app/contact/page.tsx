import {
  CatalogueBanner,
  ConnectedPublicFooter as PublicFooter,
  ConnectedPublicHeader as PublicHeader,
} from '../../components/ConnectedPublicShell';
import { ContactContent } from '../../components/PublicCompanyContent';
import { approvedCompanyInfo, readApprovedCompany } from '../../lib/approved-company';

export const dynamic = 'force-dynamic';
export default async function Contact() {
  const info = approvedCompanyInfo(await readApprovedCompany());
  return (
    <>
      <CatalogueBanner mode={info.mode} />
      <PublicHeader current="contact" />
      <main id="main" tabIndex={-1} className="container public-info-page">
        <ContactContent info={info} />
      </main>
      <PublicFooter mode={info.mode} />
    </>
  );
}
