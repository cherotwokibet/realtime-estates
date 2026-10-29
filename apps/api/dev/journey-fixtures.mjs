/** Explicit disposable browser-journey stock. No route, account, clock override or runtime grant. */
const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const companyIndex = (slug) => {
  if (!['realtime-estates', 'sample-homes'].includes(slug)) throw Error('Unknown journey company.');
  return slug === 'realtime-estates' ? 0 : 1;
};
export function journeyFixtureSelection(value, expected) {
  if (value === undefined) return undefined;
  if (
    !['public-search-v1', 'public-load-v1', 'enquiry-queue-v1'].includes(value) ||
    (expected && value !== expected)
  )
    throw Error('Choose the exact compatible synthetic journey fixture or omit it.');
  return value;
}
export function freezeJourneyManifest(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJourneyManifest(child);
    Object.freeze(value);
  }
  return value;
}
/** Fixed disposable lab:500 approved listings per company including the ordinary seed.
 * Four media metadata records per listing; no image bytes or configurable count.
 */
export function publicLoadStock(tenantSlug) {
  const company = companyIndex(tenantSlug),
    base = 100000 + company * 10000;
  const rows = Array.from({ length: 499 }, (_, index) => {
    const sale = index % 5 === 0;
    return {
      listingId: id(base + index),
      operationBase: 2000000 + company * 10000 + index * 10,
      slug: `synthetic-load-${tenantSlug}-${index + 1}`,
      title: `Synthetic ${tenantSlug} inventory ${String(index + 1).padStart(3, '0')}`,
      purpose: sale ? 'sale' : 'rent',
      propertyType: index % 7 === 0 ? 'studio' : 'apartment',
      amountMinor: sale ? 500000000 + index * 10000 : 1500000 + index * 100,
      rentPeriod: sale ? null : index % 11 === 0 ? 'day' : 'month',
      bedrooms: index % 7 === 0 ? 0 : (index % 8) + 1,
      privateBathrooms: 1 + (index % 3),
      sharedBathrooms: index % 3 === 0 ? 1 : null,
    };
  });
  return {
    rows,
    manifest: freezeJourneyManifest({
      total: 500,
      generated: 499,
      monthlyGenerated: rows.filter((r) => r.rentPeriod === 'month').length,
      saleGenerated: rows.filter((r) => r.purpose === 'sale').length,
      listingIds: rows.map((r) => r.listingId),
    }),
  };
}
export function publicJourneyStock(tenantSlug) {
  const company = companyIndex(tenantSlug),
    base = 40000 + company * 1000;
  const rows = Array.from({ length: 31 }, (_, index) => {
    const sale = index >= 25 && index <= 27;
    const period = index < 25 ? 'month' : sale ? null : ['day', 'week', 'year'][index - 28];
    const bedrooms =
      index === 8 ? null : index >= 3 && index <= 7 ? index + 3 : index >= 9 && index < 28 ? 2 : 0;
    const amountMinor = sale
      ? [999999999, 1000000000, 1000000001][index - 25]
      : index === 0
        ? 1999999
        : index === 2 || index === 5
          ? 2000001
          : index === 6
            ? 2000002
            : index === 7
              ? 2000003
              : index >= 9 && index < 25
                ? 2000000 + index
                : 2000000;
    return {
      listingId: id(base + index),
      operationBase: 900000 + company * 10000 + index * 10,
      slug: `synthetic-journey-${tenantSlug}-${String(index + 1).padStart(2, '0')}`,
      title: `Synthetic journey ${sale ? 'sale' : period} ${String(index + 1).padStart(2, '0')}`,
      purpose: sale ? 'sale' : 'rent',
      propertyType: bedrooms === null ? 'land' : bedrooms === 0 ? 'studio' : 'apartment',
      amountMinor,
      rentPeriod: period,
      bedrooms,
      privateBathrooms: bedrooms === null ? null : 1,
      sharedBathrooms: index === 6 ? 2 : index === 7 ? 1 : null,
      ...(index === 0
        ? {
            referenceLocation: {
              countyId: id(31004),
              localityId: id(31005),
              neighbourhoodId: id(31006),
            },
            locationDisclosure: {
              county: 'Synthetic choice county',
              town: 'Synthetic choice town',
              area: 'Synthetic choice block',
            },
          }
        : {}),
    };
  });
  return {
    rows,
    manifest: freezeJourneyManifest({
      total: 32,
      monthlyTotal: 26,
      listingIds: rows.map((row) => row.listingId),
      monthly: {
        below: id(base),
        equal: id(base + 1),
        above: id(base + 2),
        bedrooms: {
          six: id(base + 3),
          seven: id(base + 4),
          eight: id(base + 5),
          nine: id(base + 6),
          ten: id(base + 7),
          studio: id(base),
          land: id(base + 8),
        },
      },
      sale: { below: id(base + 25), equal: id(base + 26), above: id(base + 27) },
      periods: { day: id(base + 28), week: id(base + 29), year: id(base + 30) },
      referenceOutsideFirstPage: { listingId: id(base), countyId: id(31004) },
    }),
  };
}
export async function seedEnquiryJourney(db, company, tenantSlug, bootstrapAs, oldOverdue) {
  const index = companyIndex(tenantSlug),
    base = 60000 + index * 1000;
  const {
    rows: [clock],
  } =
    await db.query(`WITH clock AS (SELECT date_trunc('milliseconds',statement_timestamp()) AS instant,
    (date_trunc('day',statement_timestamp() AT TIME ZONE 'Africa/Nairobi')+interval '1 day') AT TIME ZONE 'Africa/Nairobi' AS midnight)
    SELECT to_char(instant AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "seededAt",
      to_char((midnight-interval '1 millisecond') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "todayDueAt",
      to_char(midnight AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "nextMidnightAt",
      to_char((instant-interval '2 days') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS overdue FROM clock`);
  if (!clock) throw Error('Synthetic journey clock unavailable.');
  const extraIds = [];
  for (let number = 0; number < 55; number++) {
    const enquiryId = id(base + number),
      operation = (step) => id(950000 + index * 10000 + number * 10 + step);
    extraIds.push(enquiryId);
    await bootstrapAs(db, company, company.admin, async () => {
      const result = await db.query(
        'SELECT app_api.record_enquiry($1,$2,NULL,$3,NULL,$4,$5,$6,$7) AS id',
        [
          enquiryId,
          operation(0),
          `Synthetic journey prospect ${String(number + 1).padStart(2, '0')}`,
          `journey-${tenantSlug}-${number + 1}@example.invalid`,
          'Fictional journey fixture only; no real prospect or contact is represented.',
          'staff',
          'synthetic-staff-notice-v1',
        ],
      );
      if (result.rows[0]?.id !== enquiryId)
        throw Error('Synthetic journey enquiry capture failed.');
    });
    if (number >= 53) continue;
    const assigned = number < 50 ? company.agent : company.peer;
    async function execute(actor, step, expected, kind, status = null, next = null, reason = null) {
      await bootstrapAs(db, company, actor, async () => {
        const result = await db.query(
          'SELECT app_api.execute_enquiry_operation($1,$2,$3,$4,$5,$6,$7,$8) AS receipt',
          [
            enquiryId,
            operation(step),
            expected,
            kind,
            kind === 'assign' ? assigned : null,
            status,
            next,
            reason,
          ],
        );
        if (result.rows[0]?.receipt?.outcome !== 'applied')
          throw Error('Synthetic journey enquiry operation refused.');
      });
    }
    await execute(company.admin, 1, 1, 'assign');
    if ([0, 1, 2, 50].includes(number)) {
      const next = number === 0 || number === 50 ? clock.todayDueAt : clock.overdue;
      await execute(assigned, 2, 2, 'transition', 'contacted', next);
      if (number === 1) {
        await execute(assigned, 3, 3, 'transition', 'qualified', next);
        await execute(assigned, 4, 4, 'transition', 'closed_won');
      } else if (number === 2)
        await execute(
          assigned,
          3,
          3,
          'transition',
          'spam',
          null,
          'Synthetic fixture spam closure.',
        );
    }
  }
  return freezeJourneyManifest({
    adminTotal: 60,
    agentTotal: 53,
    extraIds,
    oldOverdue,
    today: id(base),
    closedWon: id(base + 1),
    spam: id(base + 2),
    peerToday: id(base + 50),
    seededAt: clock.seededAt,
    todayDueAt: clock.todayDueAt,
    nextMidnightAt: clock.nextMidnightAt,
  });
}
