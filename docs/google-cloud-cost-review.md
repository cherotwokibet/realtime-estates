# Google Cloud reference cost review — 19 November 2026 EAT

This is a reproducible USD comparison, not an approved regional quote or spending authorization. Billing remains disabled. The KES 10,000 client price and KES 6,000 external-service allocation still apply. No promotional credits, commitments or free-tier discounts are assumed.

Google's default Iowa (us-central1) tables currently list shared-core micro at $0.0105/hour, small at $0.035/hour, dedicated Enterprise CPU at $0.0413/vCPU-hour and memory at $0.007/GiB-hour. SSD is $0.000232877/GiB-hour and used backups $0.000109589/GiB-hour. Shared-core instances lack Cloud SQL SLA coverage. Regional selection changes pricing. Source: [Google Cloud SQL pricing](https://cloud.google.com/sql/pricing).

At 730 hours, with a hypothetical 10 GiB SSD plus 10 GiB used backups:

| Reference configuration                  | Compute USD/month | Storage + backups USD/month | Reference subtotal USD/month |
| ---------------------------------------- | ----------------: | --------------------------: | ---------------------------: |
| Shared micro, evaluation only            |             7.665 |                       2.500 |                       10.165 |
| Shared small, evaluation only            |            25.550 |                       2.500 |                       28.050 |
| Dedicated 1 vCPU + 3.75 GiB, single-zone |            49.312 |                       2.500 |                       51.812 |

These are our calculations from the cited rates, excluding taxes, FX/card charges, transfer, replicas, PITR log growth, application hosting and independent backup exports. They do not verify Johannesburg or Belgium rates, minimum deployable shape, capacity, performance or production availability acceptance.

Cloud Run's default reference request-billing rates are $0.000024/vCPU-second, $0.0000025/GiB-second and $0.40/million requests. Across all services, an illustrative 100,000 requests at 0.2 seconds, 1 vCPU and 0.5 GiB gives $0.545 before discounts, excluding builds, registry, logging and networking. This is a workload assumption, not a measurement or price ceiling. Free quotas are aggregated per billing account. Source: [Cloud Run pricing](https://cloud.google.com/run/pricing).

The dedicated SQL subtotal alone consumes KES 6,000 when the applicable billed conversion exceeds approximately KES 115.80/USD (6000/51.811501); this is a threshold calculation, not an observed exchange rate. Therefore a single-client production plan must not assume that dedicated managed SQL fits the allocation. Shared evaluation hardware does not establish the required production reliability. With multiple paying realtors, shared infrastructure can amortize fixed cost, but do not count uncontracted revenue.

Before provisioning, capture selected-region SKUs/calculator output, account currency and tax/FX, separate staging/production duty cycles, expected tenants and load, backup/PITR and independent restore costs, object storage/egress, transactional email, domain, secrets, builds/registry and logs. Compare the complete monthly total against the allowance. Record the chosen service reliability and cold-start behavior with operator acceptance; no region or instance has been selected here.

Continue local staff/runtime integration while this quote is completed. Any later billing/paid-plan change requires resolving the existing prohibition with Boniface; this reference review grants no such approval. Do not create another staging project or request Firebase login again.
