# Paused listings in the web and admin pilot

Checkpoint 437, 18 November 2026 EAT. The integrated pilot now ends with an admin pausing the newly published listing in each synthetic company. Realtime Estates and Sample Homes both passed. The connected web catalogue hid the listing from the studio search and returned a missing detail result. An anonymous read of the previously published gallery URL returned 404.

The web enquiry handler rejected a new attempt for the paused listing with HTTP 404. Reusing the original attempt key returned HTTP 201 with the same enquiry ID. A signed staff read still showed the existing viewing as confirmed. This protects the existing follow-up while taking the listing out of public circulation.

Three checks passed in the signed local HTTP pilot. The run used the web catalogue loader and enquiry handler with a disposable API and database. The operator and browser retest of the paused-listing scenario is pending. Tasks 12-3 and 12-7 remain open.

[Local pilot test output](pilot437-checks.txt)
