# ♞ Chess

Play a game, challenge a friend, and revisit your best moves.

A browser chess app built with vanilla JavaScript and Sass. Play together on one screen or connect with an online opponent, chat during the game, and save your move history for later.

[Play Chess](https://chess.picinfiniti.net) · [Report an issue](https://github.com/PicInfiniti/app-chess/issues) · [PicInfiniti](https://picinfiniti.net/)

## Features

- **Local play** — take turns on the same board.
- **Online opponents** — send play requests to available players and connect through PeerJS. A Cloudflare lobby lists players and pairs people waiting for an opponent.
- **Click or drag** — select a piece to see possible moves, then click a destination or drag it into place.
- **Recover online games** — refresh or reconnect in the same browser and return to your seat and last agreed position.
- **Game history** — undo, redo, replay, and load histories in local play; export online games as JSON.
- **Built-in chat** — choose a nickname and send messages and emoji.
- **Game controls** — start a new game, resign, or leave an online match.

## Run locally

Use **Node.js 24**, matching `.nvmrc`. Node.js 22 starting at 22.13 is also supported.

```bash
git clone https://github.com/PicInfiniti/app-chess.git
cd app-chess
nvm use
npm ci
npm run dev
```

If you do not use nvm, install a supported Node.js version and skip `nvm use`. Open the local URL printed by Vite.

### Your first game

1. Choose a nickname in the chat panel and press **Enter**.
2. Play locally by taking turns, select an available player in **Online** to send a game request, or click **Find opponent** to be paired with another waiting player.
3. Click a piece and its destination, or drag the piece to move it.
4. Open the **⚙** menu to start a new game, save your history, or load a saved game.

The arrows above the board step backward and forward through moves; the middle playback control replays the history. **Save** downloads `history.json`, which you can import through **Load**.

Local play does not require a backend. Online discovery and automatic pairing use the Cloudflare lobby. Moves and chat use PeerJS/WebRTC; both players also submit compact checkpoints to Cloudflare for recovery. Online play still depends on PeerJS signaling and may require TURN on restrictive networks.

## Development

| Command                | Purpose                                                               |
| ---------------------- | --------------------------------------------------------------------- |
| `npm run dev`          | Start the development server                                          |
| `npm run build`        | Create the production build in `dist/`                                |
| `npm run preview`      | Preview the production build locally                                  |
| `npm run lint`         | Check JavaScript with ESLint                                          |
| `npm run lint:fix`     | Apply automatic lint fixes                                            |
| `npm run format`       | Format supported files with Prettier                                  |
| `npm run format:check` | Check formatting                                                      |
| `npm test`             | Run chess rules, storage, recovery, lobby, peer, and deployment tests |
| `npm run check`        | Run lint, formatting, tests, build, and Worker validation             |
| `npm run deploy`       | Validate, build, and publish to the deployment branch                 |

Run `npm run check` before submitting changes. GitHub Actions runs the same checks on pushes and pull requests. Indented `.sass` files are excluded from Prettier; `.editorconfig` supplies their whitespace conventions.

### Project layout

```text
index.html                 Chess UI
public/                    Static favicon and custom-domain CNAME
src/
  main.js                  Application entry and shared styles
  core/
    App.js                 jQuery UI and game initialization
    game.js                Main UI event handlers
  assets/
    js/
      api.js               Peer connections and matchmaking
      recovery.js          Private seat recovery and checkpoint confirmation
      lib/                 Board and piece logic
      ui/                  Board setup and game interactions
    sass/                  Styles and font declarations
    pieces/                Chess piece SVGs
    fonts/                 Local chess font
scripts/                   Node/Git deployment utility
tests/                    Deployment integration tests
backend/                   Cloudflare lobby and expiring game Durable Objects
shared/                    Compact checkpoint schema and hashing
wrangler.jsonc             Lobby deployment and allowed frontend origins
server.py / utils.py       Legacy Flask backend (unused by the frontend)
vite.config.js             Build inputs, base path, and @ alias
```

The `@` import alias points to `src/`. Additional HTML files under `pages/` are automatically included in the build. jQuery and jQuery UI are bundled locally; piece artwork and fonts are processed by Vite.

## Configuration

Defaults work without an environment file. To customize them:

```bash
cp .env.example .env
```

| Variable         | Default                                                   | Purpose                          |
| ---------------- | --------------------------------------------------------- | -------------------------------- |
| `BASE_PATH`      | `/`                                                       | Public URL prefix for the app    |
| `VITE_LOBBY_URL` | Local dev: `ws://localhost:8787/lobby`; production: unset | Cloudflare lobby WebSocket URL   |
| `DEPLOY_REMOTE`  | `origin`                                                  | Git remote used for deployment   |
| `DEPLOY_BRANCH`  | `gh-pages`                                                | Branch used to publish the build |

Restart the development server after changing environment files. Browser-facing `VITE_*` values are public and embedded at build time.

### Cloudflare matchmaking lobby

The lobby replaces Flask. It keeps a live list of players, marks pending/active opponents as busy, and pairs two players who choose **Find opponent**. Moves and chat travel over PeerJS; recovery checkpoints go to a separate game Durable Object. The public lobby is capped at 100 connected players for this initial version.

Run the backend and frontend in separate terminals:

```bash
npm run lobby:dev
npm run dev
```

Open the frontend in two different browser profiles (or a regular and private window), choose a nickname in each, and click **Find opponent** in both. Alternatively, click a player in the Online list and accept the request on the other browser. Use **Leave The Game** to return to the lobby. Pending connections time out after 20 seconds; stale lobby clients are removed after 90 seconds. A lobby outage does not disconnect an established PeerJS game. A game-storage outage pauses new moves until checkpoint confirmation resumes. Search is canceled on lobby disconnect; it is not automatically resumed.

To publish the lobby:

1. Create/sign in to your Cloudflare account using `npx wrangler login`. SQLite-backed Durable Objects work on the Workers Free plan.
2. Set `ALLOWED_ORIGINS` in `wrangler.jsonc` to your frontend's exact origin (scheme + hostname + optional port, without a path or trailing slash). Remove local development origins when deploying publicly. Keep both SQLite migrations: `ChessLobby` (v1) and `ChessGame` (v2).
3. Run `npm run lobby:check` to validate the Worker, then `npm run lobby:deploy`.
4. Copy the printed Worker URL into `.env.production`, adding the `/lobby` path:

   ```dotenv
   VITE_LOBBY_URL=wss://chess-lobby.YOUR-SUBDOMAIN.workers.dev/lobby
   ```

5. Build and publish the frontend with `npm run deploy` (or upload `dist/` to your host).

The Worker exposes `/health`, `/lobby`, and authenticated `/game/<id>` WebSockets. It uses WebSocket hibernation, socket attachments for presence, and Durable Object storage for temporary games; no Python server is needed. Connection capacity, message size limits, action throttling, and an origin allowlist are basic safeguards for a hobby lobby, not authenticated player identities or comprehensive abuse protection. Moves are still validated by browsers; this is not a server-authoritative or ranked chess service. The browser uses chess.js for legal moves, castling, en passant, promotion, checkmate, and draws. Matching confirmations protect against a single player rewriting the agreed checkpoint; they do not prevent engine assistance or collusion.

### Recovery and automatic cleanup

Each match (automatic pairing or an accepted invitation) gets its own game Durable Object and two independent random seat tokens. Cloudflare sends each token privately to its owner and stores only token hashes. The browser keeps its own token, nickname, color, and any outgoing unconfirmed checkpoint in localStorage. Tokens are not included in chat, PeerJS messages, the public roster, or URL query strings.

After a move, both browsers independently replay the compact UCI move sequence and check the resulting FEN, which includes turn, castling rights, en passant, and move counters. Each seat submits the same SHA-256 checkpoint hash over its authenticated WebSocket. The game record advances only after both seats agree. A pending move pauses further play; on reconnect it is replayed and validated before confirmation. The stored hash identifies an agreed checkpoint; it is not a cryptographic proof of fair play.

Refreshing either or both browsers restores the committed position, any pending confirmation, the original colors, and a new PeerJS connection. A disconnected opponent pauses play. Guest recovery works in the same browser profile and site origin: clearing site storage, changing devices, or closing a private session loses the token. Chat is not saved. Opening the same seat in another tab disconnects the older tab instead of allowing two active connections.

A Durable Object alarm deletes the game, pending state, and token hashes **24 hours after the last confirmed checkpoint**, even if both players have left. Creation starts the initial 24-hour window; a newly confirmed move or resignation restarts it. Pings, duplicate confirmations, and reconnects do not extend it. Expired games are also rejected immediately on access if alarm delivery is delayed. This uses per-game alarms, not a periodic cron job.

**Leave The Game** and **New Game** discard this browser's recovery credential. New Game returns to local play; find or invite another opponent for a fresh online match. The temporary server record still expires automatically. Online undo, replay, and imported histories are disabled to preserve the agreed game. Resignation is confirmed and saved; checkmate and draws are derived by replaying the saved moves. Games are capped at 1,024 plies (512 full moves).

To verify recovery manually:

1. Run `npm run lobby:dev` and `npm run dev`; use two browser profiles with separate nicknames.
2. Pair using Find opponent, make moves, and wait for **Connected — game saved**.
3. Refresh one browser, then both. Check that colors, moves, and promotion choices remain identical.
4. Interrupt a connection and reconnect. Play should pause, recover, and continue from the agreed position.
5. Resign and refresh to check the result; use New Game to leave the saved match.

Deploy the updated Worker **before** deploying the updated frontend. Recovery applies to matches created by the new version; pre-existing PeerJS-only matches have no recovery record.

## Deployment

Build the app and inspect it locally:

```bash
npm run build
npm run preview
```

Upload the contents of `dist/` to your static host, or publish to GitHub Pages with the included deployment utility.

### GitHub Pages

1. Configure your public URL in `.env.production`:
   - **Custom domain or root URL:** `BASE_PATH=/`
   - **Project URL:** `BASE_PATH=/app-chess/`, or your repository name
2. Update `public/CNAME` for your own domain, or remove it when deploying without a custom domain. The repository currently uses `chess.picinfiniti.net`.
3. Ensure the deployment remote and Git authentication are configured, along with `user.name` and `user.email`.
4. Run `npm run deploy`.
5. In repository **Settings → Pages**, choose **Deploy from a branch**, select **gh-pages**, and use **/ (root)**.

Deployment runs the full project check, publishes only the build output, adds `.nojekyll`, and preserves the built `CNAME`. It retains deployment history without force-pushing or changing the source branch. CI validates the project without publishing it.

## Credits

Created by [PicInfiniti](https://picinfiniti.net/).

The development and deployment tooling is adapted from [PicInfiniti/template-vite](https://github.com/PicInfiniti/template-vite), upstream commit `586f3e96dc01e350b7c3c69afffd122c31160335`. Its MIT license notice is retained in [LICENSE.template-vite](LICENSE.template-vite).
