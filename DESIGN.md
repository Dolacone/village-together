# Design

Implementation of `requirements/`. Terms follow `requirements/GLOSSARY.md`.

## Stack

| Part | Choice |
|------|--------|
| Server | Node.js 24, TypeScript run directly by Node, `ws`, `node:sqlite` |
| Client | TypeScript, Canvas 2D, bundled by Vite |
| Login | Email header set by the authenticating proxy in front of the game |
| Packaging | One container, SQLite file on a Docker volume |

- `node:sqlite` prints an ExperimentalWarning on Node 24 at startup.
- Server code uses erasable TypeScript syntax only, and imports carry the `.ts` extension.

## Layout

| Path | Holds |
|------|-------|
| `shared/data.ts` | Tables: terrains, resources, wild animals, items, buildings, attributes, limits |
| `shared/rules.ts` | Pure rules: AP, regeneration, action time, durability, routes, wildlife |
| `shared/protocol.ts` | State and message types shared by server and client |
| `server/world.ts` | World state, every player action, and the advance of actions over time |
| `server/app.ts` | Static files, WebSocket connections, tick, state push |
| `server/db.ts` | SQLite persistence |
| `server/mapgen.ts` | Seeded map generator |
| `client/` | Login, naming, map canvas, panels, chat |

## Decisions outside the requirements

All numbers live in `shared/data.ts`.

- A new character starts with full AP.
- One step takes 10 minutes before multipliers.
- One round of gathering takes 10 minutes and yields 1 item.
- A tile holds 100 of the resource its terrain is rich in, regenerating 2 per hour, and 10 of each other resource, regenerating 1 every 2 hours.
- Attribute level = floor(sqrt(proficiency / 100)). Each level shortens the action by 5%, down to 50%.
- An action adds its base minutes to the proficiency of its attribute. A step adds 10.
- Time multipliers from terrain, building, attribute, tool, and fed state multiply together. An action lasts at least 1 second.
- A building goes from 100% to 0% durability in 30 days.
- A tile holds a wild animal in 15% of its wildlife periods. A period lasts 6 hours.
- Raw meat feeds for 20 minutes and roast meat for 120 minutes.
- A pouch raises the backpack limit by 50, once.
- The ground of a tile has no capacity limit.
- A durability above 0% shows as at least 1%. A building repairs only when it shows less than 100%.
- Putting down a site, repairing, eating, putting items down, and picking items up are possible during an action.
- A tile outside the map appears in the view as a dark empty tile.
- Chat is not stored.

## World map (REQ-002)

- `generateMap(seed)` builds the 500x500 map from two noise fields, elevation and moisture.
  - Elevation sinks towards the map edge. The lowest 10% of the tiles that join the edge are coast.
  - Of the land, the highest 3% is high mountain and the next 12% is mountain.
  - Of the rest, the wettest 35% is forest and the driest 15% is waste. The remainder is grass.
- A river starts on a random mountain tile and follows the cheapest low route to the coast. One river starts per 5,000 tiles.
  - The route never crosses a high mountain.
  - A river stops where it touches another river.
  - A river tile that would form a 2x2 block of river is not placed.
- The spawn point is the centre tile. The 3x3 tiles around it are grass.
- Terrain is not stored. The server rebuilds it from the seed at startup. `WORLD_SEED` sets the seed of a new world.
- The database stores a tile once it differs from its start state: stock, structure, ground items, or a defeated animal.

## Time (REQ-002 條件 5, REQ-003 條件 5-9)

- Resource stock, AP, durability, and actions are stored as a value plus the time the value was reached. The current value is computed when read.
- An action stores its start time, its length, and the time removed by acceleration. It ends at start + length - removed time.
- `World.tick()` runs every second and advances every action in progress, for online and offline players.
  - A move applies each finished step in order.
  - A building action credits each finished minute to the site.
  - Gathering, crafting, and fighting apply their result at the end.
- After a restart, the first tick applies everything that finished while the server was down.
- AP accrues at the acting rate up to the end of the action and at the idle rate after it.
- The client computes the shown AP and the time left with the same functions, using the server clock offset from the last state message.

## Actions (REQ-003 條件 6-7, 11)

- Gathering takes the rounds from the stock of the tile at its start. A stopped gathering returns the unfinished rounds to the stock.
- A gathering asked for more rounds than the stock holds starts with the rounds the stock holds.
- The state message carries no stock amount, only whether one round of each resource can be gathered.
- Crafting holds its materials in the action. Held materials keep losing durability.
- The round in progress when an action is stopped counts as unfinished.
- A route is searched inside the 13x13 view of the character with `findPath`. The client uses the same function to show the travel time.
- The step times of a move are fixed when the move starts.

## Items (REQ-005)

- A backpack and the ground of a tile hold one stack per item kind: quantity, durability, and the time of that durability.
- New items start at 100%.
- Ground items are brought up to date before a storehouse appears on or disappears from their tile.

## Wildlife (REQ-007)

- `wildlifeAt(seed, x, y, terrain, period)` decides the animal of a tile for a wildlife period. Nothing is stored for a living animal.
- Each tile starts its periods at its own offset.
- A tile stores the period in which its animal was defeated.
- The animal of a fight in progress stays on the tile after its period ends.
- Tools of the fight attribute shorten a fight. A character takes no damage.

## Login (REQ-003 條件 1-3)

```
browser -> proxy: Google login -> proxy sets X-Auth-Request-Email on every request
WebSocket /ws
  header missing              -> socket closes with code 4401 -> client shows a notice
  email has no character      -> server sends needName -> client sends create{name}
  email has a character       -> server sends state
```

- The `accounts` table maps an email to one player id.
- The game performs no login of its own and trusts `X-Auth-Request-Email`.
  - The proxy must remove a client-supplied copy of the header.
  - Only the proxy may reach the game's port.

## Sync (REQ-001 條件 1)

- The server is the only writer. Every action is validated and applied in `World`, then saved to SQLite.
- Each message and each tick return the tiles whose shown state changed and the players whose own state changed. Those players and every online player whose view holds one of the tiles receive a full state message: own character, 13x13 view, own tile detail.
- Every online player also receives a state message every 60 seconds, which carries resource regeneration, wild animals, and durability.
- A player is online while at least one WebSocket of that player is open.

## Storage

- `meta.schema` holds the version of the stored world. The server refuses a database of another version.
- A world of version 0.1 cannot be loaded. `docker compose down -v` deletes it.
- A tile stored by 0.2.0 holds a single stock. The server converts it when it loads the tile.

## Test coverage

| Requirement | Automated | By hand |
|-------------|-----------|---------|
| REQ-001 條件 1 shared world, sync | `tests/world.test.ts`, `tests/server.test.ts` | |
| REQ-001 條件 2-3 pixel art, PC and mobile browser | | headless Chrome screenshots at 1200 px and 390 px width |
| REQ-001 條件 4 docker | | image built and started on the release host |
| REQ-002 | `tests/mapgen.test.ts`, `tests/world.test.ts`, `tests/rules.test.ts` | map drawing: screenshots |
| REQ-003 條件 1 Google login | identity taken from the header, connection without it closed | headless Chrome through a local proxy that sets the header |
| REQ-003 條件 2-12 | `tests/world.test.ts`, `tests/rules.test.ts`, `tests/server.test.ts` | headless Chrome: move, stop button shown, speed up |
| REQ-004 | `tests/world.test.ts`, `tests/rules.test.ts` | headless Chrome: put down a road site, build it |
| REQ-005 | `tests/world.test.ts`, `tests/rules.test.ts` | headless Chrome: gather wood and stone, put down, eat |
| REQ-006 | `tests/server.test.ts` | |
| REQ-007 | `tests/world.test.ts`, `tests/rules.test.ts` | headless Chrome: trapped, fight, drops |

- `tests/server.test.ts` runs the real server over real WebSocket connections that carry the identity header.
- The colour of a worn building on the map (REQ-004 條件 7) is covered as a tint level in tests. The drawn colours were not checked on a screenshot.
