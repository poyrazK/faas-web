# Console foundation pilot qualification

Date: 2026-09-23. Base: `048385d` (`origin/main`).

## Scope

This is the New app form pilot, not the full console redesign. It retains the three-step flow, API sequence, source options, colors, and existing global chrome.

- Scoped body, label, control and surface tokens; shared Input/Select controls.
- Accessible FormField composition with labels and simultaneous hint/error associations.
- App-name validation after blur or submit; first-invalid focus and Enter submission.
- Unsupported invocation cost estimate removed; actual account limits retained.
- Resource settings collapsed by default, with selected memory and idle behavior visible.

## Automated evidence

- Baseline: 143 test files, 1,111 tests passed.
- Red/green: FormField associations/focus, name boundaries and untouched/blur/submit behavior, cost removal, resource disclosure and Free-plan restrictions.
- Compatibility tests exercise existing template/import routes and bind-before-deploy/retry behavior.
- Build includes TypeScript, Vite and prerendering 29 routes.
- Full check passed: typecheck, lint within the existing warning budget, formatting, and 1,131 tests across 145 files.

## Browser evidence

Local mock API only; no production resources or customer data used. Chromium, desktop 1440×1000 and mobile 390×844, reduced motion. Screenshots are session artifacts under `/tmp`, not durable assets in this repository.

| Check                                     | Result                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Source, Configure, Review, failed create  | Captured before/after at both widths; controls/actions accessible                                |
| Free / paid / quota reached               | Capacity text retained; full-quota submit disabled; Free memory/residency restrictions preserved |
| Validation                                | Untouched input quiet; invalid submit focuses input; corrected value proceeds                    |
| Disclosure                                | Enter/Space opens/closes; closed controls skipped by Tab; summary target at least 44px           |
| Review and Back                           | Selected memory and residency retained                                                           |
| Disconnected GitHub / unavailable account | Git entry blocked with no mutations; unavailable account still uses existing connection fallback |
| Failed create                             | Configuration retained; no bind/build call                                                       |
| Failed bind, then retry                   | One create, two bind attempts, one build submission                                              |
| Rejected submission, then retry           | One create, two bind attempts, two submission attempts                                           |
| Accepted / live / failed build            | Actual mocked server state shown; endpoint link only on live                                     |
| Template / empty / import                 | Legacy entry links retained; template Review still explicitly hands deployment to CLI            |
| Light onboarding / marketing              | Onboarding form legible with 36px fallback controls; marketing canvas unchanged                  |
| 200% CSS zoom                             | No horizontal overflow; focused controls and actions scroll into view                            |

Reference captures: `/tmp/gregale-final-390-configure.png`, `/tmp/gregale-final-1440-configure.png`, `/tmp/gregale-pilot-plan-full.png`, `/tmp/gregale-pilot-onboarding.png`, `/tmp/gregale-pilot-zoom.png`, and `/tmp/gregale-pilot-bind-failed.png`.

## Qualification boundaries

An external developer walkthrough, native browser zoom/screen-reader qualification, and a supported end-to-end deployment on a disposable real account are still pending. Mock checks do not certify production behavior or improved activation. The broader two-step flow requires a separately verified source/environment orchestration contract.

No push, PR, merge, new telemetry, backend change, or subsequent redesign slice is authorized by this execution.

## Execution rulings

1. Installed skill scripts had CRLF line endings; temporary LF-normalized copies were used. Risk: bookkeeping only, not product behavior.
2. Engineering implementation and local qualification are separate from external developer/real-account acceptance. Risk: usability or production issues may remain; human qualification precedes release.
3. Plan examples used an unsupported Testing Library `exact: true` role-query option. Removed it: string accessible names already match exactly. Risk: query precision, covered by interaction tests.
