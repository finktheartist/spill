# Spill

Turn a pile of LEGO bricks into something you can build.

Spill is an experimental browser app for identifying loose pieces, reviewing your inventory, exploring build ideas, and working through interactive 3D instructions. It combines a React interface, a Three.js renderer, a Gemini integration, and deterministic checks for stock, collisions, support, and connections.

**Start here:** [Setup](docs/getting-started.md) · [Code map](docs/architecture.md) · [Development](docs/development.md) · [Privacy](docs/privacy.md)

## What you can do

- Photograph loose pieces and review the proposed identifications.
- Correct shapes, colors, and quantities before treating them as inventory.
- Explore a build atlas and suggestions based on available parts.
- Edit models on a 3D workbench and inspect construction issues.
- View step-by-step instructions for designs that pass the checks.

Recognition and generated designs still need human review. A passing geometry check does not establish physical strength or visual quality.

## Run locally

Use Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5180**. The interface and sample inventory are available without an API key. Photo recognition and AI generation require your own compatible Gemini model and server-side key; see [configuration](docs/getting-started.md#configure-ai-features).

```sh
npm test
npm run build
npm run preview
```

## Find your way around

| Path | What's inside |
| --- | --- |
| [`src/App.tsx`](src/App.tsx) | Main application state and screen flow |
| [`src/screens/`](src/screens/) | Capture, parts review, builds, workbench, and instructions |
| [`src/components/`](src/components/) | Shared interface components |
| [`src/lib/bricks.ts`](src/lib/bricks.ts) | Brick definitions, coordinates, and validation |
| [`src/lib/shape-first/`](src/lib/shape-first/) | Build planning and generation |
| [`src/lib/build-atlas/`](src/lib/build-atlas/) | Idea catalog, profiles, and inventory matching |
| [`src/lib/assembly-composer/`](src/lib/assembly-composer/) | Reusable assemblies and composition |
| [`server/`](server/) | Local API middleware and part search |
| [`test/`](test/) | Shared regression fixtures |
| [`docs/`](docs/README.md) | Setup, architecture, development, privacy, and attribution |

Tests live beside the modules they cover as `*.test.ts` and `*.test.tsx`.

## Project status

This is a development prototype. Model availability and capabilities depend on your account. Live provider behavior and physical builds are not covered by the automated test suite. See [known boundaries](docs/development.md#validation-boundaries).

Catalog and geometry sources are credited in [Attribution](docs/attribution.md). LEGO is a trademark of the LEGO Group; this project is independent and is not endorsed by the LEGO Group.
