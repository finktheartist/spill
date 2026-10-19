# Getting started

[Documentation index](README.md)

## Requirements

- Node.js 22.12 or newer and npm.
- A current browser with WebGL support.
- For AI features: a Gemini API key and access to a compatible model.

## Install and start

Run these commands from the repository root:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5180. Choose **Try a sample bucket** to explore with sample inventory. The server binds to your own computer by default.

## Configure AI features

```sh
cp .env.example .env.local
```

Edit `.env.local`: set `GEMINI_API_KEY`, then uncomment and set `BRICK_MODEL` to a model identifier available to your account. Restart the dev server after editing configuration. Neither value should be committed.

There is no default model and no fallback model. The generation pipeline requests structured JSON, high thinking, and at least 32,768 output tokens. Its decoder also supports bounded continuation when the selected model provides it. Selecting a model name alone does not establish compatibility; models that reject these request settings will report their API error.

The browser posts to `/api/gemini`. The local server adds the key and model. Never put a key in a `VITE_` variable or in frontend code. `/api/model` reports configuration status without returning the key.

## Optional full parts catalog

The repository includes a compact catalog for the supported brick shapes. The broader part-search API needs a local Rebrickable download:

```sh
npm run catalog
```

This command downloads catalog tables to `.cache/` and regenerates `src/data/rebrickable.json`. It can take time and disk space. Review the generated file before committing it. Without the cache, full catalog search reports that no local catalog is available.

## Build and preview

```sh
npm run build
npm run preview
```

Preview uses the same local API middleware. Uploading `dist/` alone to a static host does not provide the API routes. A hosted version needs its own authenticated backend and request controls.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| AI features report missing configuration | Set the server-side key and model, then restart |
| The provider rejects a request | Confirm model access and support for the settings above |
| Full part search is unavailable | Run the optional catalog sync |
| A scan looks wrong | Correct its identifications and quantities in the parts screen |
| A generated design fails validation | Treat it as a draft and inspect the reported issues |
