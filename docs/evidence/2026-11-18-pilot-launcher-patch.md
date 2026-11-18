# Pilot launch from a Windows terminal

Checkpoint 436, 18 November 2026 EAT. The synthetic pilot accepts the existing `REALTOR_TEST_POWERSHELL` convention for an explicit Windows PowerShell executable. The walkthrough explains how to set it. The default continues to use the installed Codex runtime.

Next.js 16.4.2 stopped the preview during verification. An npm audit identified 16.4.6 as the fix. Both web and admin now pin 16.4.6, and npm reported zero known vulnerabilities in the installed dependency tree after the update.

The launcher refused a missing executable before printing pilot routes. A harness without an interactive terminal timed out waiting for Next.js to serve both apps. The interactive terminal run with a valid explicit executable succeeded. The Realtime public catalogue and moderation pages each returned HTTP 200 with the expected company name. The launcher exited with status zero on `quit`. The run used the same executable as the default via the explicit setting. The separate PowerShell installation, full browser journey and operator acceptance remain pending.

All 8 launcher configuration checks, 137 web tests and 616 admin tests passed. Next run the published walkthrough with a Realtime operator and record assisted steps and defects. Tasks 12-3 and 12-7 remain open.
