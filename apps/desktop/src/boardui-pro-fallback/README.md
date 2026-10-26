# BoardUI Pro fallback

Public stand-ins for the BoardUI Pro modules that Tayfa imports as `@boardui-pro/<name>`.

`@boardui-pro/<name>` resolves to the private submodule `apps/desktop/src/boardui-pro/<name>` when
that file exists (official builds fetch it with a read-only deploy key), and to this folder otherwise
(forks, contributors, CI jobs without the key). TypeScript (`tsconfig.json` `paths`) and Vite/Vitest
(`tooling/boardui-resolver.ts`) try the two locations in the same order.

Rules:

- Every module here is written for Tayfa from the free (MIT) BoardUI components in
  `apps/desktop/src/boardui/` and Tayfa's own code. It keeps the Pro module's exports and props so
  callers work with either source, but it never copies, paraphrases or traces Pro source.
- Never commit a file from the submodule here or anywhere else in this repository (BoardUI Pro
  licence: https://www.boardui.com/license). `tests/boardui-licence-guard.test.ts` fails when a public
  file is byte-identical to a submodule file.
- `pro-source.ts` is the example module: it reports which location the alias resolved to.
