import { notFound } from 'next/navigation';
import {
  CatalogueBanner,
  ConnectedPublicFooter as PublicFooter,
  ConnectedPublicHeader as PublicHeader,
} from '../../../components/ConnectedPublicShell';
import { AdvisorContent } from '../../../components/PublicCompanyContent';
import { publicAdvisor, publicCompanyInfo } from '../../../lib/public-company';

export const dynamic = 'force-dynamic';
export default async function Advisor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const info = publicCompanyInfo(process.env);
  const advisor = publicAdvisor(info, id);
  if (!advisor) notFound();
  return (
    <>
      <CatalogueBanner mode={info.mode} />
      <PublicHeader />
      <main id="main" className="container public-info-page">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <a href="/">Home</a>
          <span aria-hidden="true">/</span>
          <a href="/company">Company</a>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{advisor.name}</span>
        </nav>
        <AdvisorContent info={info} advisor={advisor} />
      </main>
      <PublicFooter mode={info.mode} />
    </>
  );
}
