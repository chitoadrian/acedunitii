# KaTeX 0.19.1 (MIT)

Pinned upstream browser distribution from https://registry.npmjs.org/katex/-/katex-0.19.1.tgz.
Upstream release: https://github.com/KaTeX/KaTeX/releases/tag/v0.19.1.

- npm integrity: `sha512-jG8uKntjSEcm2EpQOh0XturpPuuC9r3Sq5HLHdsFdWZT27E672SF19QEi+of0/YeOy15lDgRhKvr5614uRrEfA==`
- `katex.min.js` SHA-256: `fa140498b8cfc8302cbe5e7cb1bdbc1f952bc38b3fa258ede09e73edbf9a74bc`
- `katex.min.css` SHA-256: `00e0b094171b07f58422075f469b4feac2b2f7bce1aeec943c08da4d697f4dcf`

The JavaScript, stylesheet, fonts and LICENSE are unmodified upstream assets.
They load only when the authenticated Tutor displays a mathematical expression,
not during landing, login or Dashboard initialization. No CDN or new build step.

Untrusted expressions use `trust: false`, bounded expansion and size, fresh macros,
HTML + accessible MathML output and an escaped plain-text fallback on parse failure.
Code blocks never pass through KaTeX. No history/database payloads are rewritten.
