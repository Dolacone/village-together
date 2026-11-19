# Design

Implementation of `requirements/`. Terms follow `requirements/GLOSSARY.md`.

## Stack

| Part | Choice |
|------|--------|
| Server | Node.js 24, TypeScript run directly by Node, `ws`, `node:sqlite` |
| Client | TypeScript, Canvas 2D, bundled by Vite |
| Login | Google Identity Services button, ID token verified with `google-auth-library` |
| Packaging | One container, SQLite file on a Docker volume |

- `node:sqlite` prints an ExperimentalWarning on Node 24 at startup.
- Server code uses erasable TypeScript syntax only, and imports carry the `.ts` extension.

## Layout

| Path | Holds |
|------|-------|
| `shared/data.ts` | Tables: terrains, resources, items, buildings, attributes, limits |
| `shared/rules.ts` | Pure rules: regeneration, AP cost, proficiency, weight, site completion |
| `shared/protocol.ts` | State and message types shared by server and client |
| `server/world.ts` | World state and every player action |
| `server/app.ts` | HTTP endpoints, static files, WebSocket sessions, state push |
| `server/db.ts` | SQLite persistence |
| `server/mapgen.ts` | Seeded map generator |
| `client/` | Login, naming, map canvas, panels, chat |

## Decisions outside the requirements

All numbers live in `shared/data.ts`.

- A new character starts with full AP.
- Giving materials to a site, and storing or taking items at a storehouse, costs 1 AP per action.
- Contributing AP to a site: the player pays the AP cost of the progress, and the log records the progress.
- Attribute level = floor(sqrt(proficiency / 100)). Each level lowers the AP cost by 5%, down to 50%.
- An action adds its base AP cost to the proficiency of its attribute.
- Cost multipliers from attribute, tool, and building multiply together. The result rounds up, minimum 1 AP.
- A storehouse has no capacity limit.
- When a tile holds several buildings, the map shows the one with the highest `priority`. A road is drawn as ground, under the icon.
- A tile outside the map appears in the view as a dark empty tile.
- A session token has no expiry.
- Chat is not stored.

## World map (REQ-002)

- `generateMap(seed)` builds the 32x32 map from two smoothed noise fields: the highest 15% of elevation is mountain, the wettest 40% of the rest is forest, the rest is plain.
- The map is generated once, when the database has no `seed` in `meta`. `WORLD_SEED` sets the seed.
- The spawn tile (16, 16) is always plain.

## Time (REQ-002 條件 3, REQ-003 條件 6)

- AP and resource stock are stored as a value plus the time the value was reached.
- The current value is computed when read. No timer runs per player or per tile.
- The client computes the shown AP with the same `regenAp` function, using the server clock offset from the last state message.

## Login (REQ-003 條件 1-3)

```
browser: Google button -> ID token
POST /api/login {credential} -> server verifies token -> {session}
WebSocket /ws?session=...
  account has no character -> server sends needName -> client sends create{name}
  account has a character  -> server sends state
unknown session -> socket closes with code 4401 -> client shows the login screen
```

- The `accounts` table maps a Google subject id to one player id.
- The page is served with `Referrer-Policy: no-referrer-when-downgrade`, required by Google Identity Services on `http://localhost`.
- Google Cloud Console must list `http://localhost` and `http://localhost:8080` as authorized JavaScript origins.

## Sync (REQ-001 條件 1)

- The server is the only writer. Every action is validated and applied in `World`, then saved to SQLite.
- Each action returns the tiles whose shown state changed. Every online player whose view holds one of them receives a full state message: own character, 5x5 view, own tile detail.
- Every online player also receives a state message every 60 seconds, which carries resource regeneration.
- A player is online while at least one WebSocket of that player is open.

## Test coverage

| Requirement | Automated | By hand |
|-------------|-----------|---------|
| REQ-001 條件 1 shared world, sync | `tests/world.test.ts`, `tests/server.test.ts` | |
| REQ-001 條件 2-3 pixel art, PC and mobile browser | | headless Chrome screenshots at 1200 px and 390 px width |
| REQ-001 條件 4 docker | | `docker compose up`, page and API answered |
| REQ-002 | `tests/world.test.ts`, `tests/rules.test.ts` | map drawing: screenshots |
| REQ-003 條件 1 Google login | invalid credential and unknown session rejected | a real Google account login is not yet checked |
| REQ-003 條件 2-9 | `tests/world.test.ts`, `tests/rules.test.ts`, `tests/server.test.ts` | |
| REQ-004 | `tests/world.test.ts` | |
| REQ-005 | `tests/world.test.ts` | |
| REQ-006 | `tests/server.test.ts` | |

- `tests/server.test.ts` runs the real server with a stand-in token verifier, over real HTTP and WebSocket connections.
