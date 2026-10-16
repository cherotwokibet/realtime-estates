import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DomainError,
  parseListingJsonV2,
  parseListingSuccessorJsonV2,
  validatePricingInputV2,
} from '../dist/index.js';

test('successor JSON rejects rounded or exponential revision identities including escaped keys', () => {
  for (const raw of [
    '{"predecessor":{"revision":1.00000000000000001}}',
    '{"result":{"revision":1e0}}',
    '{"predecessor":{"\\u0072evision":2.00000000000000001}}',
  ])
    assert.throws(() => parseListingSuccessorJsonV2(raw));
  assert.deepEqual(
    parseListingSuccessorJsonV2('{"revision":2,"description":"\\\"revision\\\":1e0"}'),
    { revision: 2, description: '"revision":1e0' },
  );
  assert.deepEqual(parseListingJsonV2('{"revision":1e0}'), { revision: 1 });
});

const rejectsJson = (source) =>
  assert.throws(
    () => parseListingJsonV2(source),
    (error) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.code, 'INVALID_LISTING_JSON_V2');
      return true;
    },
  );

test('v2 JSON guard rejects a fractional money token that native JSON.parse rounds into a safe integer', () => {
  const raw = '{"amountMinor":9007199254740991.1}';
  assert.equal(JSON.parse(raw).amountMinor, Number.MAX_SAFE_INTEGER);
  assert.equal(Number.isSafeInteger(JSON.parse(raw).amountMinor), true);
  rejectsJson(raw);
  const smallRounded = '{"amountMinor":1.0000000000000000001}';
  assert.equal(JSON.parse(smallRounded).amountMinor, 1);
  rejectsJson(smallRounded);
});

test('all fractional and exponential amountMinor number literals are refused without arithmetic coercion', () => {
  for (const token of [
    '0.1',
    '1.0',
    '-1.0',
    '1e0',
    '1E+0',
    '1e3',
    '1e-3',
    '1e309',
    '9007199254740991.1',
    '-9007199254740991.1',
  ]) {
    rejectsJson(`{"amountMinor":${token}}`);
  }
  for (const token of ['0', '-0', '-1', '1', '9007199254740991', '9007199254740992']) {
    assert.deepEqual(
      parseListingJsonV2(`{"amountMinor":${token}}`),
      JSON.parse(`{"amountMinor":${token}}`),
    );
  }
  // Integer syntax is only this guard's responsibility: wire validators still reject zero,
  // negative and unsafe integer values; this helper must not coerce or fabricate them.
});

test('decoded escaped amountMinor keys receive the same check inside nested objects and arrays', () => {
  const keys = [
    'amountMinor',
    '\\u0061mountMinor',
    'amoun\\u0074Minor',
    '\\u0061\\u006d\\u006f\\u0075\\u006e\\u0074\\u004d\\u0069\\u006e\\u006f\\u0072',
  ];
  for (const key of keys) {
    rejectsJson(`{"pricing":{"charges":[{"${key}" : 9007199254740991.1}]}}`);
    assert.equal(parseListingJsonV2(`{"${key}":100}`).amountMinor, 100);
  }
  rejectsJson('{"amountMinor":1,"nested":[{"amountMinor":2e0}]}');
});

test('JSON-looking text, escaped quotes, backslashes and other nonmatching keys cannot trigger money checks', () => {
  const value = {
    message:
      'Text "amountMinor": 9007199254740991.1 and \\u0061mountMinor, escaped slash \\ and quote \\".',
    examples: ['amountMinor', ':', '1e3', '{"amountMinor":0.1}', '\\"amountMinor\\": 0.1'],
    amountMinority: 1.25,
    AmountMinor: 1e-3,
    ['amountMinor:']: 2.5,
  };
  assert.deepEqual(parseListingJsonV2(JSON.stringify(value)), value);
});

test('coordinates and unrelated numbers retain decimals and scientific notation', () => {
  const source =
    ' \r\n {"amountMinor":100,"location":{"latitude":-1.3e0,"longitude":3.68E+1},"values":[1.25,-0.5,1e-3]} \t ';
  assert.deepEqual(parseListingJsonV2(source), JSON.parse(source));
  assert.equal(parseListingJsonV2(source).location.longitude, 36.8);
});

test('quote-required null and exact safe integer charge inputs survive parsing and shared wire validation', () => {
  const source =
    '{"declaration":"incomplete","charges":[{"id":"quote","name":"Amount to confirm","amountStatus":"quote_required","amountMinor":null,"timing":"one_off","classification":"fee","mandatory":true},{"id":"known","name":"Known optional amount","amountStatus":"known","amountMinor":9007199254740991,"timing":"one_off","classification":"fee","mandatory":false}]}';
  const parsed = validatePricingInputV2(parseListingJsonV2(source));
  assert.equal(parsed.charges[0].amountMinor, null);
  assert.equal(parsed.charges[1].amountMinor, Number.MAX_SAFE_INTEGER);
  assert.equal(parsed.declaration, 'incomplete');
});

test('guard leaves quoted/non-number amountMinor values to strict wire validation without coercion', () => {
  for (const value of [null, '9007199254740991.1', true, [], {}]) {
    const source = JSON.stringify({ amountMinor: value });
    assert.deepEqual(parseListingJsonV2(source), JSON.parse(source));
  }
  const badWire =
    '{"declaration":"complete","charges":[{"id":"known","name":"Wrong type","amountStatus":"known","amountMinor":"100","timing":"one_off","classification":"fee","mandatory":true}]}';
  assert.throws(() => validatePricingInputV2(parseListingJsonV2(badWire)), DomainError);
});

test('invalid JSON syntax and non-text input fail before token inspection', () => {
  for (const source of [
    '',
    '{',
    '{"amountMinor":01}',
    '{"amountMinor":+1}',
    '{"amountMinor":1,}',
    '{"message":"bad\\xescape"}',
    '{"message":"raw\nnewline"}',
    'undefined',
    undefined,
    null,
    100,
  ]) {
    rejectsJson(source);
  }
});

test('every duplicate amountMinor occurrence is checked even if JSON.parse would overwrite it', () => {
  rejectsJson('{"amountMinor":9007199254740991.1,"amountMinor":1}');
  rejectsJson('{"amountMinor":1,"\\u0061mountMinor":1e0}');
  assert.deepEqual(parseListingJsonV2('{"amountMinor":1,"amountMinor":2}'), { amountMinor: 2 });
});
