import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  MAX_PUBLIC_COMPANY_CONTENT_BYTES,
  MAX_PUBLIC_ADVISORS,
  validatePublicCompanyContent,
  resolvePublicCompanyContent,
} from '../dist/tests/lib/public-company-content.js';
import { publicCompanyInfo, publicAdvisor } from '../dist/tests/lib/public-company.js';
import {
  CompanyContent,
  ContactContent,
  AdvisorContent,
} from '../dist/tests/components/PublicCompanyContent.js';

const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
const document = (companySlug = 'realtime-estates') => ({
  policy: 'public-company-content-v1',
  companySlug,
  company: {
    summary: 'Independently supplied sample company summary.',
    about: 'Fictional public content for configuration tests, never approved business facts.',
    officeAddress: 'Suite "A" & B, fictional test office',
    openingHours: 'Sample hours only: Monday to Friday, 09:00 to 17:00',
  },
  advisors: [
    {
      id: companySlug + '-advisor-a',
      name: 'Ada "Sample" & Team',
      role: 'Fictional advisor role',
      bio: 'Supplied sample biography & public profile text.',
    },
    {
      id: companySlug + '-advisor-b',
      name: 'Second Sample Advisor',
      role: 'Second fictional role',
      bio: 'Second supplied sample biography.',
    },
  ],
  contact: { email: 'SUPPORT+east&west@example.invalid', phone: '0700 000 000', whatsapp: true },
});
const infoFor = (input, environment = {}) =>
  publicCompanyInfo({
    TENANT_SLUG: input.companySlug,
    WEB_PUBLIC_COMPANY_CONTENT: JSON.stringify(input),
    ...environment,
  });

test('public content validates two scoped companies and detaches deeply frozen public-only data', () => {
  for (const slug of ['realtime-estates', 'sample-homes']) {
    const input = document(slug);
    const result = validatePublicCompanyContent(input, slug);
    assert.equal(result.companySlug, slug);
    assert.equal(result.contact.phone, '+254700000000');
    assert.equal(result.contact.email, 'support+east&west@example.invalid');
    assert.equal(result.contact.whatsapp, true);
    assert.ok(Object.isFrozen(result));
    for (const nested of [result.company, result.contact, result.advisors, ...result.advisors])
      assert.ok(Object.isFrozen(nested));
    input.company.summary = 'Changed input';
    input.advisors[0].name = 'Changed input';
    input.contact.phone = '0711111111';
    assert.notEqual(result.company.summary, input.company.summary);
    assert.notEqual(result.advisors[0].name, input.advisors[0].name);
    assert.equal(result.contact.phone, '+254700000000');
  }
});

test('public content rejects unknown, inherited, hidden, accessor, sparse and symbolic fields without invoking getters', () => {
  let reads = 0;
  const getter = document();
  Object.defineProperty(getter.company, 'about', {
    enumerable: true,
    get() {
      reads++;
      return 'hidden';
    },
  });
  const arrayGetter = document();
  Object.defineProperty(arrayGetter.advisors, '0', {
    enumerable: true,
    get() {
      reads++;
      return document().advisors[0];
    },
  });
  const hidden = document();
  Object.defineProperty(hidden.contact, 'secret', { value: 'not-a-secret' });
  const sparse = document();
  delete sparse.advisors[0];
  for (const candidate of [
    getter,
    arrayGetter,
    hidden,
    sparse,
    Object.create(document()),
    { ...document(), company: Object.create(document().company) },
    { ...document(), privateApiKey: 'synthetic-value' },
    { ...document(), [Symbol('hidden')]: 'synthetic-value' },
    { ...document(), company: { ...document().company, companyName: 'Cannot override branding' } },
    { ...document(), contact: { ...document().contact, url: 'https://outside.invalid' } },
    {
      ...document(),
      advisors: [{ ...document().advisors[0], propertyIds: ['synthetic-listing'] }],
    },
  ])
    assert.throws(() => validatePublicCompanyContent(candidate, 'realtime-estates'));
  assert.equal(reads, 0);
});

test('public content bounds text, advisor identities and explicit contact declarations', () => {
  const base = document();
  for (const candidate of [
    { ...base, policy: 'PUBLIC-COMPANY-CONTENT-V1' },
    { ...base, companySlug: 'sample-homes' },
    { ...base, advisors: [...base.advisors, base.advisors[0]] },
    {
      ...base,
      advisors: Array.from({ length: MAX_PUBLIC_ADVISORS + 1 }, (_, index) => ({
        ...base.advisors[0],
        id: 'advisor-' + index,
      })),
    },
    ...['../other', 'UPPER', ' two ', 'a/b', 'a%2fb', '__proto__', 'a'.repeat(65)].map((id) => ({
      ...base,
      advisors: [{ ...base.advisors[0], id }],
    })),
    ...['', '<script>alert(1)</script>', 'line\nbreak', 'hidden\u202evalue', 'lone\ud800'].map(
      (summary) => ({ ...base, company: { ...base.company, summary } }),
    ),
    { ...base, company: { ...base.company, summary: 'x'.repeat(241) } },
    { ...base, company: { ...base.company, about: 'x'.repeat(4001) } },
    { ...base, advisors: [{ ...base.advisors[0], bio: 'x'.repeat(2001) }] },
    ...[
      { email: 'not-an-email' },
      { email: 'x@example.invalid\r\nBcc:other@example.invalid' },
      { email: 'javascript:alert(1)' },
      { phone: '+1234567890' },
      { phone: '0700000000;ext=1' },
      { whatsapp: true },
      { phone: '0700000000', whatsapp: false },
      { phone: '0700000000', whatsapp: 'true' },
    ].map((contact) => ({ ...base, contact })),
  ])
    assert.throws(() => validatePublicCompanyContent(candidate, 'realtime-estates'));
  const boundary = {
    ...base,
    advisors: Array.from({ length: MAX_PUBLIC_ADVISORS }, (_, index) => ({
      ...base.advisors[0],
      id: 'advisor-' + index,
    })),
  };
  assert.equal(
    validatePublicCompanyContent(boundary, 'realtime-estates').advisors.length,
    MAX_PUBLIC_ADVISORS,
  );
});

test('trusted text parsing rejects duplicate decoded keys, invalid scope, depth and byte overflow without partial output', () => {
  const source = JSON.stringify(document());
  const byteOnly = {
    ...document(),
    advisors: Array.from({ length: MAX_PUBLIC_ADVISORS }, (_, index) => ({
      ...document().advisors[0],
      id: 'byte-bound-advisor-' + index,
      bio: '界'.repeat(2000),
    })),
  };
  const byteOnlySource = JSON.stringify(byteOnly);
  assert.ok(byteOnlySource.length < MAX_PUBLIC_COMPANY_CONTENT_BYTES);
  assert.ok(new TextEncoder().encode(byteOnlySource).byteLength > MAX_PUBLIC_COMPANY_CONTENT_BYTES);
  assert.throws(() => validatePublicCompanyContent(byteOnly, 'realtime-estates'));
  for (const invalid of [
    '',
    'not json',
    source + '{}',
    source.replace('"companySlug":', '"companySlug":"sample-homes","companySlug":'),
    source.replace('"summary":', '"summ\\u0061ry":"duplicate","summary":'),
    source.replace('"email":', '"email":"first@example.invalid","email":'),
    source.replace('"id":', '"id":"duplicate","id":'),
    '['.repeat(7) + '0' + ']'.repeat(7),
    ' '.repeat(MAX_PUBLIC_COMPANY_CONTENT_BYTES + 1),
    byteOnlySource,
    JSON.stringify({
      ...document(),
      company: { ...document().company, about: '😀'.repeat(18000) },
    }),
  ]) {
    const result = resolvePublicCompanyContent(invalid, 'realtime-estates');
    assert.deepEqual(result, { status: 'invalid' });
    assert.ok(Object.isFrozen(result));
  }
  assert.deepEqual(resolvePublicCompanyContent(source, 'sample-homes'), { status: 'invalid' });
  assert.deepEqual(resolvePublicCompanyContent(undefined, 'realtime-estates'), {
    status: 'absent',
  });
  assert.equal(resolvePublicCompanyContent(source, 'realtime-estates').status, 'configured');
});

test('configured company routes use current brand and exact scoped advisor IDs without synthetic fallback', () => {
  const first = infoFor(document()),
    second = infoFor(document('sample-homes'));
  for (const info of [first, second]) {
    assert.equal(info.contentStatus, 'configured');
    assert.equal(info.advisors.length, 2);
    assert.equal(info.advisor, info.advisors[0]);
    const company = render(CompanyContent, { info });
    assert.ok(company.includes(info.name));
    assert.ok(company.includes('Configured public information'));
    assert.ok(company.includes('Independently supplied sample company summary.'));
    assert.doesNotMatch(
      company,
      /Synthetic sample profile|sample-advisor-realtime|sample-advisor-homes/,
    );
    assert.equal((company.match(/<h1 /g) || []).length, 1);
    for (const advisor of info.advisors) {
      assert.equal(publicAdvisor(info, advisor.id), advisor);
      assert.ok(company.includes('href="/agents/' + advisor.id + '"'));
      const profile = render(AdvisorContent, { info, advisor });
      assert.ok(
        profile.includes('Supplied sample biography') ||
          profile.includes('Second supplied sample biography'),
      );
      assert.ok(profile.includes('Property assignments are not supplied'));
      assert.doesNotMatch(
        profile,
        /Synthetic sample profile|not a real person|SAMPLE ADVISOR PROFILE|\/properties\//,
      );
      assert.match(profile, /href="\/company"/);
      assert.match(profile, /href="\/contact"/);
      assert.doesNotMatch(profile, /<img|<form|<input/);
    }
    for (const bad of [
      info.advisors[0].id.toUpperCase(),
      info.advisors[0].name,
      info.advisors[0].id + '/extra',
      ['advisor'],
      null,
      '__proto__',
    ])
      assert.equal(publicAdvisor(info, bad), undefined);
  }
  assert.equal(first.name, 'Realtime Estates Ltd');
  assert.equal(second.name, 'Sample Homes — test company');
  assert.equal(publicAdvisor(first, second.advisor.id), undefined);
  assert.equal(publicAdvisor(second, first.advisor.id), undefined);
  const foreign = render(AdvisorContent, { info: first, advisor: second.advisor });
  assert.match(foreign, /Company information is unavailable/);
  assert.ok(!foreign.includes(second.advisor.name));
});

test('only supplied contact channels become fixed links and plain text is escaped', () => {
  const info = infoFor(document());
  const contact = render(ContactContent, { info });
  assert.match(contact, /href="tel:\+254700000000"/);
  assert.match(contact, /href="https:\/\/wa\.me\/254700000000"/);
  assert.match(contact, /rel="noopener noreferrer"/);
  assert.match(contact, /href="mailto:support%2Beast%26west@example.invalid"/);
  assert.ok(contact.includes('support+east&amp;west@example.invalid'));
  assert.ok(contact.includes('Suite &quot;A&quot; &amp; B'));
  assert.match(render(CompanyContent, { info }), /Ada &quot;Sample&quot; &amp; Team/);
  for (const declared of [{ phone: '0700000000' }, { email: 'test@example.invalid' }, {}]) {
    const html = render(ContactContent, { info: infoFor({ ...document(), contact: declared }) });
    assert.equal(html.includes('href="tel:'), Boolean(declared.phone));
    assert.equal(html.includes('href="mailto:'), Boolean(declared.email));
    assert.ok(!html.includes('https://wa.me/'));
  }
  const queryLocal = render(ContactContent, {
    info: infoFor({ ...document(), contact: { email: 'help?subject=sample@example.invalid' } }),
  });
  assert.ok(queryLocal.includes('mailto:help%3Fsubject%3Dsample@example.invalid'));
  assert.ok(!queryLocal.includes('mailto:help?subject='));
});

test('invalid or foreign content is wholly unavailable and never leaks partial facts, contacts or samples', () => {
  const base = document();
  const absent = publicCompanyInfo({});
  for (const source of [
    JSON.stringify({ ...base, companySlug: 'sample-homes' }),
    JSON.stringify({ ...base, contact: { ...base.contact, secret: 'synthetic-private-marker' } }),
    JSON.stringify({ ...base, advisors: [...base.advisors, base.advisors[0]] }),
    '',
  ]) {
    const info = publicCompanyInfo({ WEB_PUBLIC_COMPANY_CONTENT: source });
    assert.equal(info.contentStatus, 'invalid');
    assert.equal(info.content, null);
    assert.equal(info.advisor, null);
    assert.deepEqual(info.advisors, []);
    assert.equal(publicAdvisor(info, absent.advisor.id), undefined);
    for (const component of [CompanyContent, ContactContent]) {
      const html = render(component, { info });
      assert.match(html, /role="alert"/);
      assert.match(html, /Company information is unavailable/);
      assert.doesNotMatch(
        html,
        /Supplied sample|sample biography|sample-advisor|support|Suite|synthetic-private-marker|href="(?:tel:|mailto:|https:|\/agents\/|\/enquire)/,
      );
    }
  }
});

test('empty configured content keeps missing facts unknown and never enables enquiry or production services', () => {
  const minimal = {
    policy: 'public-company-content-v1',
    companySlug: 'realtime-estates',
    company: { summary: 'Sample summary', about: 'Sample about' },
    advisors: [],
  };
  const production = infoFor(minimal, {
    NODE_ENV: 'production',
    WEB_CATALOGUE_MODE: 'connected',
    API_ORIGIN: 'https://api.example.test',
  });
  assert.equal(production.contentStatus, 'configured');
  assert.equal(production.synthetic, false);
  assert.equal(production.advisor, null);
  assert.equal(production.testEnquiry, false);
  assert.match(
    render(CompanyContent, { info: production }),
    /No advisor profiles have been supplied/,
  );
  const contact = render(ContactContent, { info: production });
  assert.match(contact, /Phone number not supplied/);
  assert.match(contact, /Office address not supplied/);
  assert.doesNotMatch(contact, /href="(?:tel:|mailto:|https:|\/enquire)/);
  const environment = {
    NODE_ENV: 'development',
    WEB_ENQUIRY_PREVIEW_MODE: 'synthetic-v1',
    WEB_ENQUIRY_API_ORIGIN: 'http://127.0.0.1:4555',
    WEB_ENQUIRY_INSTANCE: '11111111-1111-4111-8111-111111111111',
  };
  const enabled = infoFor(minimal, environment);
  assert.match(render(ContactContent, { info: enabled }), /href="\/enquire"/);
  const disabled = infoFor(minimal, { ...environment, NODE_ENV: 'production' });
  assert.equal(disabled.testEnquiry, false);
  assert.doesNotMatch(render(ContactContent, { info: disabled }), /href="\/enquire"/);
});
