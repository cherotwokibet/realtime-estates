# Reuse the Android rehearsal API address

Checkpoint 441, 18 November 2026 EAT. The mobile customer preview accepts `MOBILE_PREVIEW_API_PORT` to keep the same loopback API address when restarting between the lost-reply and fresh-enquiry scenarios. An omitted setting or `0` lets the operating system pick a port. A fixed port must be between 1024 and 65535.

The subprocess test started the disposable preview on a loopback port with the lost-reply flag and confirmed a concurrent launch on that address failed without interrupting the running preview. The test paused the listing, confirmed its removal through the mobile catalogue client, quit, and opened a new disposable preview at the same address. The new catalogue contained the listing again. All five mobile enquiry and customer preview tests passed.

Android Debug Bridge found no connected device. Next connect an authorized device, use the same port for both scenarios and record the installed app behaviour. The Realtime operator walkthrough can proceed independently.

[Local test output](pilot441-checks.txt)
