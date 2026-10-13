# Contact form browser verification — 13 October 2026

Local disposable signed synthetic preview, running `node scripts/enquiry-preview.mjs` and the in-app browser at `/enquiries/admin`. These are manual browser scenarios, not additional automated test counts.

1. Opened fictional unassigned enquiry at working version 1. Contact feed was empty.
2. Entered raw notes with two leading/trailing spaces and a newline. Clicking another enquiry retained the original selected enquiry and exact input; role navigation changed to the finish/discard explanation.
3. Initial datetime fill did not persist with the change-only handler; native required-field validation prevented submission. Added an input handler and retested. DOM value was `2026-10-12T15:04:05.006`, valid. Canonical original command uses the Nairobi-to-UTC conversion.
4. Saved completed call/connected contact: operation `f57a7620-5a38-4aec-94cc-46eb40db8203`. UI showed Contact recorded, original version 1, observed version 1. Feed stayed at zero until explicit refresh; refresh showed exactly one entry. DOM notes remained exactly `  Fictional follow-up completed.\nKeep original spacing.  `.
5. Explicitly cleared local contact input. Saved owner assignment to fictional agent through the separate workflow form; workflow receipt was version 2, while working/contact version stayed 1.
6. Submitted another contact at retained version 1: operation `0e1fc9d4-beb7-4125-a7fb-8a2480b5693b`. UI showed Version conflict / contact not recorded, observed version 2 and original version 1. Feed refresh still showed only the first successful contact; stale notes were absent from the feed and retained in the local form.

Screenshots in `rebuild-preservation/2026-10-12-source`: contact-form-saved.png, contact-form-conflict.png (full page), contact-form-proof.png (viewport). The actual browser viewport was 488 pixels wide; no 390px override, desktop, physical device or operator UAT pass is claimed.

Uncertain-write browser fault injection and actual browser recovery/replay were not run. The existing attempt/controller and transport tests cover those boundaries, but do not establish browser end-to-end fault recovery. No production or native verification occurred. Contact feed does not replace workflow state or contact anyone.
