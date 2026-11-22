# Village Together

A cooperative browser MMO prototype. Behaviour is specified in `requirements/`, implementation notes are in `DESIGN.md`.

## Run

The game must run behind a reverse proxy that performs the Google login and sets the `X-Auth-Request-Email` request header, for example Caddy `forward_auth` with oauth2-proxy.

- The game trusts that header as the player's identity.
- The proxy must remove a client-supplied copy of the header.
- Only the proxy may reach the game's port.

```sh
docker compose up --build -d
```

The game listens on `127.0.0.1:8080`. Point the proxy at it.

The world is stored in the `world` Docker volume. `docker compose down -v` deletes it.

A world created by version 0.1 cannot be loaded by version 0.2. Delete the volume before starting 0.2.

## Develop

Requires Node.js 24.

```sh
npm install
npm test
npm run typecheck
npm run build && npm start
```
