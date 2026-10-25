import type { PublicAdvisor, PublicCompanyInfo } from '../lib/public-company.ts';

function ProfileNotice({ info }: { info: PublicCompanyInfo }) {
  return (
    <p className="public-info-notice">
      {info.synthetic
        ? 'Synthetic development preview. Company branding is configured; the sample advisor is not a real person. No real availability or viewing booking is offered.'
        : 'Development preview. Verified company, contact and advisor information has not been supplied.'}
    </p>
  );
}

function ContactFacts() {
  return (
    <dl className="public-contact-facts">
      <div>
        <dt>Phone and WhatsApp</dt>
        <dd>Verified number not supplied</dd>
      </div>
      <div>
        <dt>Email</dt>
        <dd>Verified email not supplied</dd>
      </div>
      <div>
        <dt>Office</dt>
        <dd>Verified address not supplied</dd>
      </div>
      <div>
        <dt>Opening hours</dt>
        <dd>Verified hours not supplied</dd>
      </div>
    </dl>
  );
}

export function CompanyContent({ info }: { info: PublicCompanyInfo }) {
  return (
    <>
      <ProfileNotice info={info} />
      <section className="public-info-intro" aria-labelledby="company-title">
        <span className="eyebrow">COMPANY INFORMATION</span>
        <h1 id="company-title">{info.name}</h1>
        <p>Explore homes with clear property details and costs in one place.</p>
        <p>
          This preview demonstrates the company’s public pages. Its legal identity, history, service
          coverage and credentials still need verified information before launch.
        </p>
        <div className="public-info-actions">
          <a className="primary" href="/">
            Explore properties
          </a>
          <a href="/contact">Contact information →</a>
        </div>
      </section>
      <div className="public-info-grid">
        <section className="public-info-card" aria-labelledby="company-approach">
          <h2 id="company-approach">Clearer choices, at your pace.</h2>
          <p>
            Browse homes to rent or buy, compare the supplied property facts and review the
            disclosed price basis before making a decision.
          </p>
          <p>
            Check current availability, all charges and the viewing arrangements with a verified
            agency contact before committing.
          </p>
          <a href="/#how">How to use the catalogue →</a>
        </section>
        <section className="public-info-card" aria-labelledby="company-team">
          <h2 id="company-team">Meet the team</h2>
          {info.advisor ? (
            <>
              <p className="public-profile-kind">Synthetic sample profile</p>
              <h3>{info.advisor.name}</h3>
              <p>
                Explore the advisor page layout. No real person, accreditation or property
                assignment is represented.
              </p>
              <a href={'/agents/' + info.advisor.id}>View sample advisor profile →</a>
            </>
          ) : (
            <p>Verified advisor profiles are not available yet.</p>
          )}
        </section>
      </div>
    </>
  );
}

export function ContactContent({ info }: { info: PublicCompanyInfo }) {
  return (
    <>
      <ProfileNotice info={info} />
      <section className="public-info-intro" aria-labelledby="contact-title">
        <span className="eyebrow">CONTACT INFORMATION</span>
        <h1 id="contact-title">Get in touch with {info.name}.</h1>
        <p>
          Verified contact channels are not available in this preview. No call, email, WhatsApp
          message or office visit can be arranged here.
        </p>
      </section>
      <div className="public-info-grid">
        <section className="public-info-card" aria-labelledby="contact-details">
          <h2 id="contact-details">Contact details</h2>
          <ContactFacts />
        </section>
        <section className="public-info-card" aria-labelledby="contact-enquiry">
          <h2 id="contact-enquiry">Enquiries and viewings</h2>
          {info.testEnquiry ? (
            <>
              <p>
                A separate synthetic enquiry form is enabled for testing. Use made-up contact
                details only. It does not contact a real agent or book a viewing.
              </p>
              <a className="primary" href="/enquire">
                Open test enquiry form
              </a>
            </>
          ) : (
            <p>
              Enquiries and viewing requests are unavailable. No contact details are collected on
              this page.
            </p>
          )}
          <p>
            Property prices and availability must be confirmed through a verified channel before any
            commitment.
          </p>
          <a href="/">Continue exploring properties →</a>
        </section>
      </div>
    </>
  );
}

export function AdvisorContent({
  info,
  advisor,
}: {
  info: PublicCompanyInfo;
  advisor: PublicAdvisor;
}) {
  return (
    <>
      <ProfileNotice info={info} />
      <section className="public-info-intro" aria-labelledby="advisor-title">
        <span className="eyebrow">SAMPLE ADVISOR PROFILE</span>
        <div className="public-advisor-heading">
          <span className="public-advisor-avatar" aria-hidden="true">
            SP
          </span>
          <div>
            <h1 id="advisor-title">{advisor.name}</h1>
            <p>{advisor.role}</p>
          </div>
        </div>
        <p>
          A synthetic profile for {info.name}. This is not a real person and does not represent an
          employment relationship, verified qualification or property assignment.
        </p>
      </section>
      <div className="public-info-grid">
        <section className="public-info-card" aria-labelledby="advisor-about">
          <h2 id="advisor-about">About this profile</h2>
          <p>
            This page demonstrates how a public advisor profile connects to company information and
            contact options. Biography, languages, qualifications and service areas have not been
            supplied.
          </p>
          <p>
            No properties are assigned to this sample advisor. Browse the company catalogue to
            explore its available preview listings.
          </p>
          <a className="primary" href="/">
            Explore company properties
          </a>
        </section>
        <section className="public-info-card" aria-labelledby="advisor-contact">
          <h2 id="advisor-contact">Contact information</h2>
          <p>
            No verified personal contact information is available. The company contact page shows
            which channels are available in this preview.
          </p>
          <div className="public-info-actions">
            <a href="/contact">Company contact information →</a>
            <a href="/company">About {info.name} →</a>
          </div>
        </section>
      </div>
    </>
  );
}
