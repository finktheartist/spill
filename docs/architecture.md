# Architecture and code map

[Documentation index](README.md)

## Main flow

```text
Photos or sample inventory
          ↓
Piece recognition → human review → usable inventory
                                      ↓
                           Build ideas and planning
                                      ↓
                         Geometry and stock validation
                                      ↓
                          Workbench and instructions
```

`src/App.tsx` owns the main screen flow, inventory, scan lifecycles, and build requests. Screen components present those states; shared libraries own the domain rules.

## Where to make a change

| Area | Entry points |
| --- | --- |
| Photo loading and scan progress | `src/lib/photo-input.ts`, `src/lib/scan.ts`, `src/screens/Capture.tsx` |
| Inventory and review | `src/lib/inventory.ts`, `src/lib/piece-review.ts`, `src/screens/Parts.tsx` |
| Piece editor and tags | `src/components/PieceEditor.tsx`, `src/lib/part-tag-schema.ts` |
| Ideas and stock matching | `src/lib/build-atlas/`, `src/components/IdeaAtlas.tsx` |
| Shape-based generation | `src/lib/shape-first/pipeline.ts`, `src/lib/shape-first/whole-model.ts` |
| Assembly composition | `src/lib/assembly-composer/` |
| Construction rules | `src/lib/bricks.ts`, `src/lib/construction.ts`, `src/lib/connections.ts` |
| Rendering and manual edits | `src/lib/render.ts`, `src/lib/workbench.ts`, `src/screens/Workbench.tsx` |
| Instruction order | `src/lib/instruction-order.ts`, `src/screens/Instructions.tsx` |
| Saved discoveries | `src/lib/library-discoveries.ts`, `src/hooks/useBuildLibrary.ts` |
| Provider transport | `server/gemini-proxy.ts`, `src/lib/gemini-decode.ts`, `src/lib/gemini-rate-limit.ts` |
| Part search | `server/parts-api.ts`, `server/parts-search.ts`, `src/data/` |

## Important contracts

- Stock quantities constrain what a design may use.
- Recognition suggestions remain reviewable; the inventory records uncertainty.
- Geometry and connections are checked by code independently of model output.
- Cancellation and inventory changes invalidate stale work.
- A failed design remains a draft and must not be presented as finished instructions.
- Browser workers handle several expensive fitting and discovery operations.

The API middleware is wired through `vite.config.ts` for local development and preview. It is not a separately deployed service.
