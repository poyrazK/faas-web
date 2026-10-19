# Self-hosted fonts

Byte-identical copies of the files the CDNs served on 2026-10-19, so rendering
does not change. They live here so the Content-Security-Policy can be
first-party only (`font-src 'self'`); see `src/lib/security-headers.ts`.
Rules are in `src/fonts.css`.

| File                                                | Family           | Weight             | Subset           | Source                          | License               |
| --------------------------------------------------- | ---------------- | ------------------ | ---------------- | ------------------------------- | --------------------- |
| familjen-grotesk-{latin,latin-ext,vietnamese}.woff2 | Familjen Grotesk | 400–700 (variable) | by unicode-range | Google Fonts v11                | SIL OFL 1.1           |
| spline-sans-mono-{latin,latin-ext}.woff2            | Spline Sans Mono | 400–700 (variable) | by unicode-range | Google Fonts v13                | SIL OFL 1.1           |
| satoshi-{400,500,700}.woff2                         | Satoshi          | 400, 500, 700      | all              | Fontshare (Indian Type Foundry) | ITF Free Font License |

SIL OFL 1.1: https://openfontlicense.org — redistribution permitted with the
license notice; the fonts are not sold and not renamed.
ITF Free Font License (Fontshare): https://www.fontshare.com/licenses/itf-ffl —
free for personal and commercial use including self-hosted web embedding.
