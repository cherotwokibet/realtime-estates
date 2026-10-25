import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { publicAdvisor, publicCompanyInfo } from '../dist/tests/lib/public-company.js';
import {
  AdvisorContent,
  CompanyContent,
  ContactContent,
} from '../dist/tests/components/PublicCompanyContent.js';

const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

test('public company presentation uses exact configured identities and refuses unknown or foreign advisor IDs', () => {
  const first = publicCompanyInfo({}),
    second = publicCompanyInfo({ TENANT_SLUG: 'sample-homes' });
  assert.equal(first.name, 'Realtime Estates Ltd');
  assert.equal(second.name, 'Sample Homes — test company');
  assert.notEqual(first.advisor.id, second.advisor.id);
  assert.equal(publicAdvisor(first, first.advisor.id), first.advisor);
  for (const id of [
    second.advisor.id,
    first.advisor.name,
    first.advisor.id.toUpperCase(),
    '',
    undefined,
    null,
    ['sample-advisor-realtime'],
    '__proto__',
  ]) {
    assert.equal(publicAdvisor(first, id), undefined);
  }
  for (const slug of ['constructor', '__proto__', 'SAMPLE-HOMES', 'unknown']) {
    assert.throws(() => publicCompanyInfo({ TENANT_SLUG: slug }));
  }
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.advisor));
  assert.deepEqual(Object.keys(first).sort(), [
    'advisor',
    'advisors',
    'content',
    'contentStatus',
    'mode',
    'name',
    'slug',
    'synthetic',
    'testEnquiry',
  ]);
});

test('connected data without a synthetic declaration and invalid catalogue configuration never invent an advisor', () => {
  const environment = { WEB_CATALOGUE_MODE: 'connected', API_ORIGIN: 'https://api.example.test' };
  const unspecified = publicCompanyInfo(environment);
  assert.equal(unspecified.mode, 'connected');
  assert.equal(unspecified.synthetic, false);
  assert.equal(unspecified.advisor, null);
  assert.equal(publicAdvisor(unspecified, 'sample-advisor-realtime'), undefined);
  const explicit = publicCompanyInfo({ ...environment, WEB_CATALOGUE_DATA: 'synthetic' });
  assert.equal(explicit.advisor.id, 'sample-advisor-realtime');
  for (const overrides of [
    { API_ORIGIN: 'http://remote.example.test' },
    { WEB_CATALOGUE_DATA: 'invented' },
    { WEB_CATALOGUE_MODE: 'fallback' },
  ]) {
    const invalid = publicCompanyInfo({ ...environment, ...overrides });
    assert.equal(invalid.mode, 'unavailable');
    assert.equal(invalid.synthetic, false);
    assert.equal(invalid.advisor, null);
  }
});

test('company and advisor markup link the scoped public journey without invented contacts, assignments or credentials', () => {
  for (const slug of ['realtime-estates', 'sample-homes']) {
    const info = publicCompanyInfo({ TENANT_SLUG: slug });
    const company = render(CompanyContent, { info });
    const advisor = render(AdvisorContent, { info, advisor: info.advisor });
    assert.equal((company.match(/<h1 /g) || []).length, 1);
    assert.match(company, /aria-labelledby="company-title"/);
    assert.match(company, /href="\/contact"/);
    assert.ok(company.includes('href="/agents/' + info.advisor.id + '"'));
    assert.ok(
      !company.includes(
        slug === 'realtime-estates' ? 'sample-advisor-homes' : 'sample-advisor-realtime',
      ),
    );
    assert.match(company, /Synthetic sample profile/);
    assert.match(advisor, /No properties are assigned/);
    assert.match(advisor, /not a real person/);
    assert.match(advisor, /href="\/company"/);
    assert.match(advisor, /href="\/contact"/);
    assert.match(advisor, /href="\/"/);
    for (const html of [company, advisor]) {
      assert.doesNotMatch(html, /href="(?:tel:|mailto:|https?:\/\/|\/properties\/)/);
      assert.doesNotMatch(html, /<img|<form|<input/);
      assert.ok(html.includes('No real availability or viewing booking is offered.'));
    }
  }
  const info = publicCompanyInfo({
    WEB_CATALOGUE_MODE: 'connected',
    API_ORIGIN: 'https://api.example.test',
  });
  const company = render(CompanyContent, { info });
  assert.match(company, /Verified advisor profiles are not available yet/);
  assert.doesNotMatch(company, /href="\/agents\//);
});

test('contact page honestly marks all unavailable channels and enables only the explicitly configured synthetic enquiry path', () => {
  const disabled = render(ContactContent, { info: publicCompanyInfo({}) });
  for (const unavailable of [
    'Verified number not supplied',
    'Verified email not supplied',
    'Verified address not supplied',
    'Verified hours not supplied',
  ])
    assert.ok(disabled.includes(unavailable));
  assert.match(disabled, /No contact details are collected on this page/);
  assert.doesNotMatch(disabled, /href="\/enquire"|href="tel:|href="mailto:|<input|<form/);
  const environment = {
    NODE_ENV: 'development',
    WEB_ENQUIRY_PREVIEW_MODE: 'synthetic-v1',
    WEB_ENQUIRY_API_ORIGIN: 'http://127.0.0.1:4555',
    WEB_ENQUIRY_INSTANCE: '11111111-1111-4111-8111-111111111111',
  };
  const enabled = render(ContactContent, { info: publicCompanyInfo(environment) });
  assert.match(enabled, /href="\/enquire"/);
  assert.match(enabled, /Use made-up contact details only/);
  assert.match(enabled, /does not contact a real agent or book a viewing/);
  const production = render(ContactContent, {
    info: publicCompanyInfo({ ...environment, NODE_ENV: 'production' }),
  });
  assert.doesNotMatch(production, /href="\/enquire"/);
  assert.doesNotMatch(enabled, /4555|11111111-1111-4111-8111-111111111111/);
});
