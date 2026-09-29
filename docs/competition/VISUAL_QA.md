# Competition visual QA

Web is the primary competition surface. The final pass was reviewed deliberately against **CALM · PREMIUM · FAST · OBVIOUS**, rather than treating a working IndexedDB layer as completion.

## Widths reviewed

The workspace/editor proportions were reviewed at approximately:

- 1440 × 960 — full sidebar, centered library, docked editor
- 1024 × 800 — compact sidebar, full-width library, overlay editor
- 768 × 850 — single-column tablet workspace, compact top navigation, overlay editor
- 390 × 844 — mobile Web, single-column cards, full-screen editor

The available container could not install the Expo toolchain from npm, so the visual gate used a browser-rendered layout proxy driven by the exact Tuck tokens, seeded content, breakpoints and component proportions. The fixes were then applied to the real React Native Web source. Final static Expo export must still be inspected once dependencies are available.

## Defects corrected during review

- Mid-size laptop layouts previously docked the editor too early and squeezed the library. The editor now docks only on genuinely wide desktop screens.
- Compact sidebar mode now begins earlier so 1024-ish laptops retain useful library width.
- Mobile library and Collections pages no longer keep desktop 34px gutters.
- Mobile navigation no longer hides Archive beyond a horizontally scrolled icon row; all five destinations fit as quiet text tabs at the 390px target.
- Notes/Images empty views no longer incorrectly say that a search returned no results merely because the view applies a type filter.
- Opening another card while the desktop editor remains visible now remounts the editor for that item instead of preserving stale local field state.
- Mobile editor padding, title size, top bar and image height were tightened for 390px screens.
- Mobile Collection rows can wrap actions instead of forcing long Collection names and three actions into one narrow line.
- Card hover/elevation transitions were reduced to a fast 170ms treatment.

## Visual system retained

- warm neutral canvas and near-white surfaces
- deep green accent used sparingly
- 18px card radius / restrained borders
- strong content-first title hierarchy
- quiet but legible metadata
- substantial image treatment
- designed Inbox / Notes / Images / Archive / search empty states
- no Account, cloud, sync or login chrome in the competition path

## Remaining visual gate

Before public submission, inspect the actual `npm run web:build` artifact in Chromium at the same four widths and repair only genuine rendering differences from React Native Web or static base-path output. Do not expand product scope during that freeze check.
