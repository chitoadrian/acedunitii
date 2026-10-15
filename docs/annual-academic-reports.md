# Annual academic reports

- The server decides the official year in America/Guayaquil. April 1 opens the next cycle; March remains in the previous cycle.
- `ensure_academic_year_for_user()` fills elapsed cycles sequentially for an existing account. New accounts start in the current cycle. Future cycles cannot be inserted or selected.
- Historical academic content is read-only (confirmed by the user for this extension). Notifications/read-state metadata remain independent; global account settings are not frozen.
- `get_academic_year_report(p_academic_year_id)` is STABLE, SECURITY INVOKER and read-only. It accepts no user ID. It validates auth.uid(), year ownership and availability, then reads only that owner's selected year in one database snapshot, with RLS enabled.
- All entity queries use the existing `(user_id, academic_year_id)` indexes. Grade items are also joined to an owned grade in the same year. Activity is aggregated once, not queried per card. Resource file URLs are excluded.
- `getAcademicYearReportData()` validates the session and scope before normalizing. It does not read stale workspace caches or call a workspace sync. The report reuses the current grade, attendance, task-status, level and project-progress functions.
- Annual XP/streak come from `user_academic_years`, not `profiles`. The 2026 baseline preserves its migrated balance. No unverified global achievement history is attributed to a year.
- PDFs are generated only on request, locally, using pinned jsPDF/AutoTable files with MIT licenses. Libraries load lazily from the same site (about 453 KB combined uncompressed); no external PDF service, storage bucket or service key is used.
- The filename is `Reporte de [full name] - [start]-[end].pdf`, sanitized for filesystem characters. Missing names never fall back to an email address or UUID.
- The circular existing 192px logo keeps PDFs compact; no logo asset is changed. A4 pagination repeats table headers and includes page numbers. Empty sections remain explicit.

## Verification

With Node and `@electric-sql/pglite`, `playwright`, `acorn` available:

```powershell
node --test tests/academic-years.test.cjs tests/annual-academic-reports.test.cjs
node tests/academic-years-migration.test.cjs
```

For browser tests, serve the repository locally and set TEST_BASE_URL, TEST_BROWSER (Chrome executable), TEST_PDF_DIR and optionally TEST_SCREENSHOT_DIR:

```powershell
node tests/academic-years-browser.cjs
python tests/annual-report-pdf-check.py $env:TEST_PDF_DIR
```

The tests use a disposable local PostgreSQL database, two synthetic accounts and a simulated clock. They do not create production accounts, send emails, or modify real academic records. The PDF test downloads two actual files, including a 180-long-task stress case, checks year isolation, filenames, complete content and A4 page bounds. Use pdftoppm to render all pages before visual review.
