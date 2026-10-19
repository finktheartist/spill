# Privacy and configuration

[Documentation index](README.md)

## API keys

Keep `GEMINI_API_KEY` in the server environment or ignored `.env.local`. The server attaches it to upstream requests. The key is never intentionally returned to the browser; `/api/model` returns only a boolean indicating whether one is configured.

The included middleware is intended for use on your computer and binds to loopback by default. It has no user authentication or per-user spending limits. A public deployment needs those controls before exposing generation endpoints.

## Photos and generated content

AI recognition sends image data to the configured provider through the local server. Generation and visual review may send inventory descriptions, prompts, and rendered model views. Only use photos and content you intend to process with that provider.

The app supports local browser storage for saved discoveries and exported inventory snapshots. Exports can contain photo information. Inspect them before sharing; local browser storage is not an encrypted vault.

Part images can be fetched from Rebrickable through the local parts API. Optional catalog sync also downloads from Rebrickable. The interface loads its typefaces from Google Fonts.

## Before committing files

- Keep `.env` files, credentials, raw photos, and private exports out of Git.
- Inspect filenames and file contents, including fixture metadata.
- Check the staged diff; an ignore rule does not untrack a file already committed.
- Share only the intended source files and documentation.

If a key is ever committed, revoke it with the provider and remove it from repository history before sharing the repository further.
