# Bounded synthetic notification worker

12 November 2026 EAT, checkpoint 418. The offline worker selects up to 50 unfinished jobs in one company, ordered by due time and operation ID. It skips locked jobs and jobs whose due or retry time has not arrived. Each selected job gets its own savepoint. A failed capture or completion rolls back that job's changes and schedules a one-minute retry. Later jobs can finish in the same pass.

The fixture injected a failure while saving completion after capture. The failed job left no attempt receipt. Another job finished in that pass, a subsequent pass cleared the next due job, and the failed job finished after the retry delay without a duplicate. The test also covered company scope, invalid batch limits, future jobs and runtime access. [Fourteen focused checks](push418-checks.txt) passed across the worker, viewing reminder, consent and deletion paths.

Next expose synthetic queue counts and retry age for operator review. The tests use a disposable SQL sender and a controlled clock. Provider delivery, physical devices and task 09-3 acceptance remain open.
