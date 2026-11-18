# Connected mobile catalogue filters and offline expiry

Checkpoint 443, 18 November 2026 EAT. The mobile form and catalogue read session now run in the integrated local HTTP search test for Realtime Estates and Sample Homes. The mobile form found the monthly studios with exactly zero bedrooms. A separate search combined a strict KES 20,000.00 minimum, a KES 20,000.02 maximum, at least seven bedrooms and both bathroom criteria. The mobile reader returned only the expected listing for each company.

For each company, the test then simulated a connection failure in the mobile transport. The same query returned its prior response with the previous-data state. At the expiry boundary it returned an error. The other query also returned an error while the transport was offline.

The integrated HTTP test passed across both companies. All 28 focused mobile catalogue, search, storage and offline checks passed. The run used the mobile model and data transport from Node. Installed-app interaction and actual device network interruption still need an Android test. Next run the exact search and offline cases with an installed Android build and continue the Realtime operator walkthrough. Tasks 09-2 and 12-3 remain open.

[Integrated HTTP test](pilot443-checks.txt) · [Mobile checks](pilot443-mobile.txt)
