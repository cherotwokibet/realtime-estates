# Mobile enquiry feedback after a listing pause

Checkpoint 439, 18 November 2026 EAT. A definite unavailable response now stops the current mobile enquiry form from offering another send and explains that the property has stopped taking enquiries. Back to properties closes the form. If a submission may already have saved, Retry original request remains available.

The synthetic mobile integration exercised both companies. A fresh enquiry on a paused listing returned HTTP 404 with the expected code. The original request recovered its receipt after a lost reply and the database retained one enquiry. All eight focused checks passed. Mobile typechecking and Android bundle export passed. No installed-device session was run.

Next test the open form on Android by pausing its listing in the same mobile preview. [Device rehearsal steps](2026-11-18-mobile-preview-pause.md). Check the message, Back to properties and recovery after an uncertain reply. The web operator walkthrough can proceed independently. Tasks 09-2 and 12-3 remain open.

[Focused test output](pilot439-checks.txt)
