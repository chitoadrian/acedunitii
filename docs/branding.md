# Official branding assets

Approved source: `assets/branding/edunity-official-source.png` (1254×1254 RGB).
The source pixels match the supplied `logo-edunitynow.png`; it is not an AI recreation.

- `assets/ac-edunity-logo.png`: complete wordmark, cropped outer whitespace only;
  neutral near-white canvas made transparent, all RGB artwork preserved.
- `favicon.png`: 512px transparent symbol, without the Edunity lettering.
- `favicon-{16,32,48,192}.png`, `favicon.ico`, `apple-touch-icon.png`: derivatives
  for browser tabs, existing report cover, shortcuts and mobile devices.
- `assets/og-image.webp`: 1200×630 social card with the approved wordmark.
- `branding.css`: logo-only containment overrides; square symbols must not inherit
  the old circular clip. Full wordmarks use a white surface for their navy text.

The approved source is raster. No traced/reconstructed SVG is supplied, to avoid
changing the original geometry and gradients. PNG/ICO fallbacks are configured.

Regenerate with Python + Pillow (no frontend dependency):

```sh
python tools/build-branding.py assets/branding/edunity-official-source.png
python tests/branding-assets.py
node --test tests/branding-assets.test.cjs
```

Branding resource version: `20261022-official-branding-v1`.
The report module changes only the URL of its existing logo fetch, not PDF logic.
No build tool, package.json, deploy workflow or hosting credentials are present:
the repository is a directly served static HTML/CSS/JS site. Publish through the
existing Git workflow; verify the public asset hashes after deployment.
