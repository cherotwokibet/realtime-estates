# Synthetic notification queue in admin

12 November 2026 EAT, checkpoint 421. The local staff workspace links to a read-only notification queue preview. The same-origin route uses the configured staff credential and validates the signed company summary. The page refreshes on demand, displays the database measurement time, and clears the previous counts while refreshing. Access revocation returns an unavailable message with the counts removed.

The browser opened the preview from the staff workspace and read one due job, one scheduled job and zero suppressions. After the disposable worker ran, refresh showed zero due jobs, one scheduled job and one suppression at a later server timestamp. After revocation, the browser received a 403 and removed the summary. The [initial view](push421-queue.png), [refreshed view](push421-refreshed.png) and [revoked view](push421-revoked.png) record those states. The [signed HTTP regression](push421-checks.txt) and [admin build](push421-admin-build.txt) passed.

Next check for owned Android device access and exercise consent withdrawal and pending deletion through the app if available. If device access is pending, review the app link association and website fallback requirements for task 09-4. Provider delivery, production deletion and task 09-3 acceptance remain open.
