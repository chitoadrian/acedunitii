# On-demand PDF libraries

Vendored, version-pinned npm distributions. Loaded only after clicking **Generar reporte**; no CDN calls or automatic PDF generation.

| File | Package | License | SHA-256 |
| --- | --- | --- | --- |
| jspdf-4.2.1.umd.min.js | jspdf@4.2.1 | MIT (jspdf-LICENSE.txt) | 5feb83f439480e06687f9e6f23a8a162b12157b9606aa6ffc70c7e961b7c6013 |
| jspdf-autotable-5.0.9.min.js | jspdf-autotable@5.0.9 | MIT (jspdf-autotable-LICENSE.txt) | 086214ba9355a6e90786616ec689ea9a26dc151811239f96be0635633258d6f6 |

Sources: https://www.npmjs.com/package/jspdf/v/4.2.1 and https://www.npmjs.com/package/jspdf-autotable/v/5.0.9.

Hashes use the repository's LF representation. Only trailing spaces in upstream license comments were removed for `git diff --check`; executable code and license wording are unchanged.

The report passes plain text, never user-supplied HTML, to these libraries. The existing 192px circular logo is reused to keep the PDF small without altering branding.
