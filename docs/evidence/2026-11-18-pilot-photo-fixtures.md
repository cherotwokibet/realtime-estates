# Synthetic photos for the Realtime operator pilot

Checkpoint 435, 18 November 2026 EAT. From the platform root, run `node scripts/pilot-photos.mjs`. It prints a new folder containing four distinct PNGs for the listing upload steps. Use the filenames to keep the gallery order clear.

Two command runs wrote separate folders and produced matching hashes for each corresponding image. Within each folder all four hashes differed. The gallery upload test uses the same generator. The native gallery and both signed local company journeys passed all four checks, including public image reads and removal from public view after a publication pause. The checks used disposable preview data.

Boniface can now run the Realtime walkthrough with a colleague using the generated files. Operator feedback and device verification remain pending. Tasks 12-3 and 12-7 remain open.

[Local verification log](pilot435-checks.txt)
