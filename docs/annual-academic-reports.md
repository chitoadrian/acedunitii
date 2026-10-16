# Annual academic reports

- The server decides the official year in America/Guayaquil. April 1 opens the next cycle; March remains in the previous cycle.
- `ensure_academic_year_for_user()` fills elapsed cycles sequentially for an existing account. New accounts start in the current cycle. Future cycles cannot be inserted or selected.
- Historical academic content is read-only (confirmed by the user for this extension). Notifications/read-state metadata remain independent; global account settings are not frozen.
- `get_academic_year_report(p_academic_year_id)` is STABLE, SECURITY INVOKER and read-only. It accepts no user ID. It validates auth.uid(), year ownership and availability, then reads only that owner's selected year in one database snapshot, with RLS enabled.
- Live queries use the existing `(user_id, academic_year_id)` indexes. The report alone unions live records with owner/year-scoped deletion snapshots. A live record wins when the same entity UUID is present in both sources. Activity is aggregated once, not queried per card. Resource file URLs are excluded from both live and archived payloads.
- `getAcademicYearReportData()` validates the session and scope before normalizing. It does not read stale workspace caches or call a workspace sync. The report reuses the current grade, attendance, task-status, level and project-progress functions.
- Annual XP/streak come from `user_academic_years`, not `profiles`. The 2026 baseline preserves its migrated balance. No unverified global achievement history is attributed to a year.
- PDFs are generated only on request, locally, using pinned jsPDF/AutoTable files with MIT licenses. Libraries load lazily from the same site (about 453 KB combined uncompressed); no external PDF service, storage bucket or service key is used.
- The filename is `Reporte de [full name] - [start]-[end].pdf`, sanitized for filesystem characters. Missing names never fall back to an email address or UUID.
- The circular existing 192px logo keeps PDFs compact; no logo asset is changed. White A4 pages include an executive metric grid, a mutually exclusive task balance, grade/attendance bars, goal/project progress, full tables, evidence coverage and a final report block. Pagination repeats table headers and page numbers. Empty sections use short callouts instead of empty tables.

## Immutable deletion history

Migration `20261015161306_academic_record_history.sql` adds `academic_record_history` and a private, fixed-search-path BEFORE DELETE trigger on all 12 academic tables: subjects, tasks, events, evaluations, attendance, resources, grades, grade_items, goals, projects, project_stages and project_subtasks. It does not change live queries, delete handlers, reminder workers or academic data. No active rows are backfilled into history.

- The ledger contains full OLD snapshots, original owner/year, deletion time and limited relationship context. The unique owner/year/entity/record index serves report scope lookups; an entity/record index supports cascade parent lookup. Follow-up migration `20261015161909_optimize_academic_history_fk.sql` adds the composite FK index in declared year/owner order, verified by the database advisor.
- Authenticated clients can SELECT their own available years only. INSERT, UPDATE and DELETE are revoked (also from service_role). Only the private trigger's narrowly scoped SECURITY DEFINER write path inserts snapshots. It is not exposed as an RPC and EXECUTE is revoked from API roles. The report RPC remains SECURITY INVOKER with owner checks and RLS.
- Grade item cascades resolve ownership from the live grade, its BEFORE snapshot or its immutable year owner. Project/stage snapshots retain the child IDs present at deletion so derived progress can reuse the existing functions without including children deleted earlier.
- When a subject deletion SET NULLs surviving children, its snapshot records their IDs. The report can name their former subject without changing the live row or restoring anything in the app. Current grade grouping still uses the actual live subject association (including General); contextual restoration never changes the final average.
- The unique constraint prevents duplicate snapshots for the same entity identity. A failed DELETE rolls its snapshot back. Account/year teardown can cascade the ledger for privacy; there is no end-user history-edit endpoint.
- This is deletion history, not an audit of every UPDATE. Retained rows represent current values; a deleted row represents its final snapshot. Replacing grade items during an edit creates separate UUIDs: these are counted as registered/deleted casilleros, not asserted to be distinct assessments.

### Totals and final state

Created totals count recoverable live plus archived UUIDs. Task balance is disjoint: completed (including completed-then-deleted), current pending/upcoming/overdue, and deleted without completion. The independent "deleted records" count includes completed deletions and is explicitly labeled; it must not be added again to the balance.

The final grade average uses only retained grade groups and retained items, through the existing 70/30 functions. Deleted/replaced items count toward historical registrations, not the final average. No hypothetical historical average is produced from different versions. Attendance exposes conserved and deleted status distributions without inventing unknown statuses; its general percentage uses conserved records and the existing attendance rule.

### Earlier losses

The schema audit found creation/completion activity events but no complete deleted-row audit or deletion messages in recent_activity/internal_notifications. Missing source UUIDs in user_activity_events provide evidence only. The RPC deduplicates this evidence per entity/UUID within the owner/year and returns it separately as legacy_evidence. It cannot recover titles, due dates, subject relationships or notes. It is not added to complete-record totals and does not create fake snapshots. Therefore "complete year" is guaranteed for surviving data plus deletions captured since installation, not for irreversibly deleted pre-installation content.

## Verification

With Node and `@electric-sql/pglite`, `playwright`, `acorn` available:

```powershell
node --test tests/academic-years.test.cjs tests/annual-academic-reports.test.cjs
node tests/academic-years-migration.test.cjs
node tests/academic-record-history.test.cjs
```

For browser tests, serve the repository locally and set TEST_BASE_URL, TEST_BROWSER (Chrome executable), TEST_PDF_DIR and optionally TEST_SCREENSHOT_DIR:

```powershell
node tests/academic-years-browser.cjs
python tests/annual-report-pdf-check.py $env:TEST_PDF_DIR
```

The automated tests use a disposable local PostgreSQL database, two synthetic accounts and a simulated clock. They do not create production accounts, send emails, or modify real academic records. The history test verifies 5 created -> 3 workspace / 5 report / 2 deleted, cascades, rollback, immutable permissions, two users/years, historical read-only and fresh snapshots. The browser stress case contains 180 long tasks plus one created through the UI: 171 retained, 10 deleted and 181 in the PDF, with 60 completions. Grade/attendance and project snapshots exercise non-empty charts. Use pdftoppm to render all pages before visual review.

`tests/academic-record-history-rollback.sql` is an optional, explicitly authorized server-side verification. It creates only clearly named temporary academic rows under an existing owner, with reminders OFF, validates the deployed triggers/RLS/RPC, then ROLLBACKs the entire transaction. It must never be changed to commit. Production verification on deployment confirmed all 20 tracked table hashes unchanged and zero test rows/snapshots remaining.
