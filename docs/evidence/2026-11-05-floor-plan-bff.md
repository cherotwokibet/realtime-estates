# Private floor-plan admin boundary — checkpoint367

5 November 2026 EAT. Synthetic data only.

Protected admin routes and a same-origin browser adapter now connect floor-plan upload, preparation recovery, attachment and attachment recovery. All 17 focused checks passed, including an actual Windows coordinator across the adapter, BFF and API. Progress remains 54/97 (56%).

New default-off development-only loopback BFF routes expose bounded binary PUT and GET-only preparation recovery, attachment POST and POST /recover mapped to an upstream GET, and saved revision metadata GET. STAFF_PREVIEW_FLOOR_PLAN and existing reference/preview policies must be explicit. The boundary captures server configuration, compares caller identity stamps with the verified current session, requires an adopted current revision, rechecks protocol and metadata consistency, refuses stale edits before reading source bytes, and rechecks current actor/company before releasing a result. The bearer remains server-only. A bounded source reader, deadline, concurrent-upload guard, exact route/body bindings and no-store headers cover the transport. Read-only recovery allows the original expected version after later edits.

The browser adapter snapshots ordinary Uint8Array bytes, rejects shared backing buffers, uses same-origin URLs with credentials omitted/redirect errors, and validates exact bounded private receipts. Preparation recovery never resends bytes. The adapter does not yet retain original commands; the forthcoming screen/session layer must persist them before dispatch and lock conflicting edits.

Validation: admin test compilation and full admin TypeScript typecheck passed.17 focused tests passed,0 failures,0 skips (floor367-bff.txt):11 new floor-plan checks plus6 video/protocol regressions. Native integration uses actual Windows processing, durable synthetic stores, actual isolated restricted SQL and in-process API/BFF Request/Response calls; the browser fetch adapter is invoked in Node, not in a browser. Session/protocol responses are simulated in that composition and API identity is a fixed synthetic verifier; this is not new signed-provider/login, listening-network, browser or device evidence. One upload, one attachment command and one native run remain after both original recoveries. Other cases exercise disabled/production/foreign-origin refusal, changed actor/protocol/version, private framing, no body read before refusals, scoped credentials, malformed acknowledgements, concurrent uploads, and browser byte snapshotting.

The admin workspace now declares its existing local @realtor/media dependency for the server-only bounded source helper; lockfile changes only declare the workspace dependency. No registry install, GitHub Actions or paid compute used.

Next, implement the retained-original floor-plan author/reviewer screens and private image BFF, connect the opt-in local preview composition, and verify the actual browser flow. Then add approved/public snapshots and successor-copy rules under task06-4.

No author/reviewer UI, preview deployment, public output or launch gate accepted. Task06-4 remains open;54/97 broad tasks,0/14 exit gates.

Additional local validation after packaging: full Next admin build passed; all4 new dynamic routes appear in floor367-admin-build.txt. This supplemental build log stays canonical locally for the next dashboard evidence refresh.
