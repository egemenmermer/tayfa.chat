# BoardUI in Tayfa

Free (MIT) BoardUI components adapted to Tayfa's tokens. Licence: `LICENSE` in this folder; overview
of licences in `docs/THIRD_PARTY_NOTICES.md`. Owner decisions: coordinator spec "BoardUI in Tayfa".

- `foundations/`: `globals.css` (Tailwind entry: no preflight, utilities only inside BoardUI regions),
  `theme.css` (BoardUI semantic tokens pointing at `reference-tokens.css`), `typography.css`
  (composite `text-*` styles in px, 11px floor), `cx.ts`, `root.tsx` (`<BoardUiRoot>`, the region
  every BoardUI surface renders in).
- `base/`: components, imported as `@boardui/base/<name>`. BoardUI's `@/components/base/...` and
  `@/utils/...` imports become `@boardui/base/...` and `@boardui/foundations/...`.
- Changes to the upstream source are limited to imports, Tayfa tokens and `t()` for built-in labels
  (Turkish source, English in `locales/en/core.ts`). Style with semantic tokens, never raw palette
  classes or `dark:` colours.
- BoardUI Pro is licensed separately: it lives only in the private submodule `../boardui-pro`
  (imported as `@boardui-pro/<name>`, with public stand-ins in `../boardui-pro-fallback`). Never copy
  Pro source into this repository, an issue or a PR. Do not run the BoardUI CLI or `init_boardui` /
  `install_components` in this pnpm workspace; write files from `get_component` output instead.
