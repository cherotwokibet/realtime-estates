import { CatalogueBanner, PublicFooter, PublicHeader } from '../../components/PublicShell';
import { ContactContent } from '../../components/PublicCompanyContent';
import { publicCompanyInfo } from '../../lib/public-company';

export const dynamic = 'force-dynamic';
export default function Contact() {
  const info = publicCompanyInfo(process.env);
  return (
    <>
      <CatalogueBanner mode={info.mode} />
      <PublicHeader current="contact" />
      <main id="main" className="container public-info-page">
        <ContactContent info={info} />
      </main>
      <PublicFooter mode={info.mode} />
    </>
  );
}
