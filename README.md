# Village Together

A cooperative browser MMO prototype. Behaviour is specified in `requirements/`, implementation notes are in `DESIGN.md`.

## Run

1. In Google Cloud Console, create an OAuth 2.0 Client ID of type "Web application".
   - Add `http://localhost` and `http://localhost:8080` to "Authorized JavaScript origins".
2. Copy `.env.example` to `.env` and set `GOOGLE_CLIENT_ID`.
3. Start the game:

   ```sh
   docker compose up --build -d
   ```

4. Open `http://localhost:8080`.

The world is stored in the `world` Docker volume. `docker compose down -v` deletes it.

## Develop

Requires Node.js 24.

```sh
npm install
npm test
npm run typecheck
npm run build && GOOGLE_CLIENT_ID=<id> npm start
```
