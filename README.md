# AI-Powered API Documentation Generator

Drop in an **OpenAPI 3.x** spec (JSON or YAML) or a **Postman Collection v2.1**, and
get beautiful, Mintlify-style interactive docs with **AI-generated example
requests**, **6-language code snippets**, a **try-it playground**, and an
**auto-generated changelog** that diffs successive versions of the same API.

Built with Next.js 16, TypeScript 5, Tailwind CSS 4, shadcn/ui, Prisma 6 +
SQLite, the `z-ai-web-dev-sdk`, `bun test`, and `eslint-config-next`.

---

## Overview

`AI API Docs Generator` turns a raw API contract into a navigable,
copy-paste-ready documentation site. The import pipeline:

1. **Parses** the spec into a single unified internal shape
   `{ info, servers, endpoints[] }` — regardless of whether the source was
   OpenAPI 3.x JSON/YAML or a Postman v2.1 collection.
2. **Generates examples** for every endpoint via an LLM
   (`z-ai-web-dev-sdk`), falling back to a deterministic, schema-aware
   heuristic when the LLM is offline.
3. **Renders docs** — per-endpoint parameters tables, request/response
   schema trees, AI examples, and a tabbed code-snippet panel
   (`curl`, `JavaScript`, `TypeScript`, `Python`, `Go`, `Rust`).
4. **Proxies requests** from the in-app playground to the spec's server URL
   and surfaces the upstream status, headers, body, and timing.
5. **Diffs versions** — re-importing a spec with the same name emits an
   automatic changelog of added / removed / modified endpoints.

---

## MVP scope (implemented)

- **Spec ingestion** — `POST /api/specs/import` accepts an OpenAPI 3.x
  document (JSON or YAML) **or** a Postman Collection v2.1 JSON. The parser
  inlines `$ref`s, normalises servers, and flattens Postman folders into
  tag-grouped endpoints.
- **AI-generated examples** — each endpoint row persists 1–2 LLM-generated
  example requests (path params filled with realistic ids like `user_123`,
  bodies sampled from the schema). Re-generation is one click
  (`POST /api/endpoints/[id]/regenerate-examples`).
- **Code snippets in 6 languages** — pure-function
  `generateCodeSnippet(endpoint, example, lang)` renders `curl`,
  `JavaScript (fetch)`, `TypeScript (fetch + types)`, `Python (requests)`,
  `Go (net/http)`, and `Rust (reqwest)`, each using the example values.
- **Interactive playground** — fill path / query / header params + a JSON
  body and hit *Send*. The backend (`POST /api/endpoints/[id]/playground`)
  proxies to the spec's `serverUrl` and returns
  `{ status, headers, body, durationMs }`.
- **Auto changelog** — `diffSpecs(old, new)` compares endpoint paths/methods
  and response-schema field counts; re-importing a named spec persists
  `ChangelogEntry` rows surfaced via `GET /api/specs/[id]/changelog`.

### Stretch (documented, not built)

- **Live API test mode** — wire the playground to a real CORS proxy
  (Caddy / `cors-anywhere`) so browser-side requests work against APIs
  that don't send permissive CORS headers.
- **Multi-version docs** — keep multiple versions side by side and let the
  reader toggle between them instead of overwriting on re-import.
- **Real OAuth flow examples** — inject bearer/refresh-token flows into
  the playground headers with a real auth-code grant.
- **Mintlify-style theming** — full design-system port with sidebar
  navigation, search, and MDX prose blocks around each operation.

---

## Features

- Multi-format ingestion (OpenAPI JSON **and** YAML, Postman v2.1) behind
  one normaliser.
- AI example generation with a deterministic offline fallback so the docs
  pane is never empty.
- Six copy-pasteable snippet languages, generated client-side from the
  selected example.
- A real try-it playground that proxies through the server (timing + status
  + headers + body panel).
- Structural changelog diffing on every re-import, persisted per spec.
- 3-column responsive UI (spec list + endpoint tree · endpoint detail ·
  playground), dark-mode ready, sticky header, custom scrollbars.

---

## Tech stack

| Layer            | Choice                                                        |
| ---------------- | ------------------------------------------------------------ |
| Framework        | Next.js 16 (App Router) + TypeScript 5                        |
| Styling          | Tailwind CSS 4 + shadcn/ui (New York) + lucide-react          |
| Database         | Prisma 6 + SQLite (single file, zero infra)                  |
| AI               | `z-ai-web-dev-sdk` (non-streaming `complete()`)              |
| Tests            | `bun test` (`bun:test`)                                       |
| Lint             | `eslint-config-next`                                          |
| YAML             | `js-yaml` (OpenAPI YAML ingestion)                           |

---

## Architecture

```
                   ┌─────────────────────────────────────────────┐
   raw spec  ─────▶│  POST /api/specs/import                      │
 (json/yaml/       │   parseRawDocument (json | js-yaml)          │
  postman)         │   parseOpenApi3 | parsePostmanV21            │
                   │   generateExamplesForEndpoint (LLM|heuristic)│
                   │   diffSpecs(prev, next)  ──▶ ChangelogEntry  │
                   └─────────────┬───────────────────────────────┘
                                 ▼
              ┌──────────────── Prisma (SQLite) ────────────────┐
              │  ApiSpec  1───*  Endpoint                        │
              │  ApiSpec  1───*  ChangelogEntry                  │
              └────────────────┬────────────────────────────────┘
                                 ▼
            ┌─────────── /api/specs/[id] ────────────┐    ┌── /api/endpoints/[id]/playground
            │  serialize rows → EndpointView[]        │    │  buildProxyRequest → executeProxyRequest
            │  + changelog                            │    │  → { status, headers, body, durationMs }
            └────────────────────┬───────────────────┘    └───────────────┬───────────
                                 ▼                                         ▼
   ┌──────────────────────── page.tsx (3-column client) ─────────────────────────────┐
   │ Left: spec list + endpoints grouped by tag (Accordion)                            │
   │ Center: method/path + parameters table + request body schema + AI example        │
   │         + 6-language code-snippet tabs (generateCodeSnippet) + "Open in          │
   │         playground"                                                               │
   │ Right: playground form (params/body/headers) + response panel                    │
   └──────────────────────────────────────────────────────────────────────────────────┘
```

---

## Setup

```bash
# 1. install deps
bun install

# 2. materialise the SQLite db from the Prisma schema
bun run db:push        # inlines DATABASE_URL="$(pwd)/db/custom.db"

# 3. run the dev server (Next.js 16, port 3000)
bun run dev

# 4. run the test suite (pure-function tests, no DB needed)
bun test
```

Import a spec from the UI (*Import spec* in the header) by pasting raw
JSON/YAML or uploading a file. A sample 3-endpoint OpenAPI 3.0 spec lives at
`scripts/sample-spec.json` — paste its contents into the import dialog to
try the playground end-to-end.

### Environment variables

Copy `.env.example` to `.env` and adjust:

```
# absolute path to the SQLite database (required for Prisma)
DATABASE_URL=file:/home/z/my-project/apps/89-ai-api-docs-generator/db/custom.db

# set to 1 to force the deterministic MockProvider (offline mode)
PKC_DISABLE_LLM=0
```

The `z-ai-web-dev-sdk` reads its own credentials from the environment when
`ZAI.create()` is called; when those are missing the AI layer automatically
falls back to `MockProvider` so the app stays demoable.

---

## Tests

`bun test` runs 58 tests across seven files, all exercising pure functions
so no database or live LLM is required:

```
src/lib/__tests__/spec-parser.test.ts       8   OpenAPI 3.x parsing + $ref inlining
src/lib/__tests__/postman-parser.test.ts    7   Postman v2.1 folders + variables
src/lib/__tests__/example-generator.test.ts 12  prompt building + JSON parsing + heuristic
src/lib/__tests__/code-snippet.test.ts      12  curl/js/ts/python/go/rust + URL building
src/lib/__tests__/playground.test.ts         8  proxy-request shaping + mock fetch
src/lib/__tests__/changelog-diff.test.ts    6   added/removed/modified/unchanged
src/lib/__tests__/ai.test.ts                5   MockProvider + provider caching
```

---

## Project structure

```
89-ai-api-docs-generator/
├── prisma/schema.prisma            # ApiSpec, Endpoint, ChangelogEntry
├── scripts/sample-spec.json        # 3-endpoint OpenAPI 3.0 demo
├── src/
│   ├── app/
│   │   ├── layout.tsx               # Geist fonts + Sonner toaster
│   │   ├── page.tsx                 # 3-column interactive UI (only route)
│   │   ├── globals.css              # Tailwind 4 + custom scrollbar/code
│   │   └── api/
│   │       ├── specs/import/route.ts        # parse + persist + examples + diff
│   │       ├── specs/route.ts               # list
│   │       ├── specs/[id]/route.ts          # GET (full) + DELETE
│   │       ├── specs/[id]/changelog/route.ts
│   │       ├── endpoints/[id]/regenerate-examples/route.ts
│   │       ├── endpoints/[id]/playground/route.ts  # proxy
│   │       └── stats/route.ts
│   ├── components/ui/               # shadcn/ui subset used by the UI
│   └── lib/
│       ├── types.ts                # unified ParsedSpec / Endpoint / Example
│       ├── spec-parser.ts          # parseOpenApi3 + $ref resolution
│       ├── postman-parser.ts       # parsePostmanV21
│       ├── example-generator.ts    # buildExamplePrompt + parseExamplesResponse
│       ├── code-snippet.ts         # generateCodeSnippet (6 langs)
│       ├── playground.ts           # buildProxyRequest + executeProxyRequest
│       ├── changelog-diff.ts       # diffSpecs
│       ├── ai.ts                   # ChatProvider (Zai / Mock)
│       ├── db.ts / serialize.ts / utils.ts / tokenizer.ts
│       └── __tests__/*.test.ts
```

---

## Case study — what makes this non-trivial

1. **Multi-spec-format parsing behind one normaliser.** OpenAPI 3.x and
   Postman v2.1 have radically different shapes (paths/operations vs.
   nested folders, `$ref` vs. collection variables, schema vs. raw body).
   Both parsers emit the same `{ info, servers, endpoints[] }`, so every
   downstream feature — examples, snippets, playground, changelog — works
   on either format with zero branching. The OpenAPI parser also does
   in-place `$ref` inlining with a cycle guard so generated examples never
   leak unresolved references.
2. **AI example generation with a deterministic fallback.** The example
   layer is split into `buildExamplePrompt` / `parseExamplesResponse` /
   `generateExamplesForEndpoint`. The LLM call is wrapped so any failure
   (offline, malformed JSON, quota) degrades gracefully to a schema-aware
   heuristic that fills path params with plausible ids and bodies from the
   declared properties — the docs pane is never blank.
3. **Six-language code snippets from one example.** `generateCodeSnippet`
   is a pure function that takes the unified endpoint + one example and
   renders curl / JS / TS / Python / Go / Rust, filling path params,
   building the query string, merging headers, and serialising the body.
   Because it is pure, the snippet panel updates instantly on the client
   with no API round-trip.
4. **Real playground proxy.** The playground doesn't fake the request —
   `buildProxyRequest` assembles a fetch-shaped request and
   `executeProxyRequest` proxies it through the server, returning real
   status, headers, body, and timing. The test suite injects a mock `fetch`
   to assert the exact request shape without network access.
5. **Changelog diffing.** `diffSpecs` keys endpoints by `METHOD path` and
   compares response-schema field counts, parameter counts, and
   request-body presence to classify added / removed / modified, persisting
   `ChangelogEntry` rows on every re-import of a named spec.

---

## What I'd do differently with more time

- **Real CORS proxy.** The playground proxies server-side, which works for
  simple cases but needs a real CORS proxy (and an allow-list) for
  browser-facing APIs that restrict cross-origin requests.
- **Real auth token injection.** The playground only sends what the user
  types. A production version should let you configure an OAuth/refresh
  flow and inject the bearer token automatically per request.
- **Real Mintlify theme.** The current UI is functional shadcn — a
  full Mintlify-style port would add a sidebar search, MDX prose around
  operations, and version switcher.
- **Multi-version docs.** Re-importing overwrites the changelog against the
  last version; a true version manager would keep every version browsable
  and render per-version diffs on demand.

### Resume bullet

> Built an AI-powered API documentation generator (Next.js 16, TS, Prisma,
> z-ai-web-dev-sdk) that ingests OpenAPI 3.x and Postman v2.1 specs, uses an
> LLM to generate realistic example requests, renders six-language code
> snippets and a live proxy playground, and auto-diffs successive spec
> versions into a persisted changelog — 58 unit tests across parsers,
> snippet generators, the playground proxy, and the changelog differ.

---

## License

MIT — see [`LICENSE`](./LICENSE).

---

## Push to GitHub

```bash
gh repo create ai-api-docs-generator --public --source=. --remote=origin --push
```
