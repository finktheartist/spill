# Development

[Documentation index](README.md)

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local app and API middleware |
| `npm test` | Run the included automated tests |
| `npm run build` | Type-check and produce the browser build |
| `npm run preview` | Serve the built app with local API middleware |
| `npm run catalog` | Download catalog data and regenerate the compact snapshot |

For a focused test run:

```sh
npm test -- src/lib/inventory.test.ts
```

Tests sit beside their modules. Shared layouts live in `test/whole-animal-fixtures.ts`; anonymized regression data lives in `test/fixtures/` and `src/lib/fixtures/`.

## Making changes

1. Find the owning module in the [code map](architecture.md).
2. Preserve inventory, connection, cancellation, and finished-build contracts.
3. Run tests relevant to the behavior you changed.
4. Run `npm run build` before sharing a change.
5. Review staged files for credentials, private media, and local-only paths.

## Validation boundaries

The included suite covers program behavior, geometry, inventory, planning, rendering data, and mocked provider transport. It does not establish live model access, browser visual quality, scan accuracy on your photos, or physical build strength.

Historical source-audit tests that require external research archives, private photo-grading tools, recorded comparison demos, and local review reports are not part of this distribution. They were not replaced with skipped or automatically passing tests.

The API adapter has no bundled model selection. Test model identifiers are fictional. A real model must support the generation settings described in [Getting started](getting-started.md#configure-ai-features).

## Repository scope

This repository contains the application, portable tests, supporting catalog data, and documentation. Local credentials, original photos, generated media, cache downloads, and working-session archives are excluded.
