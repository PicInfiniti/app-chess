# ♞ Chess

Play a game, challenge a friend, and revisit your best moves.

A browser chess app built with vanilla JavaScript and Sass. Play together on one screen or connect with an online opponent, chat during the game, and save your move history for later.

[Play Chess](https://chess.picinfiniti.net) · [Report an issue](https://github.com/PicInfiniti/app-chess/issues) · [PicInfiniti](https://picinfiniti.net/)

## Features

- **Local play** — take turns on the same board.
- **Online opponents** — send play requests to available players and connect through PeerJS.
- **Click or drag** — select a piece to see possible moves, then click a destination or drag it into place.
- **Game history** — undo and redo moves, replay a game, or save and load a JSON history.
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
2. Play locally by taking turns, or select an available player in **Online** to send a game request.
3. Click a piece and its destination, or drag the piece to move it.
4. Open the **⚙** menu to start a new game, save your history, or load a saved game.

The arrows above the board step backward and forward through moves; the middle playback control replays the history. **Save** downloads `history.json`, which you can import through **Load**.

Local play does not require the matchmaking backend. Online discovery requires the matchmaking service, and online connections require PeerJS signaling.

## Development

| Command                | Purpose                                               |
| ---------------------- | ----------------------------------------------------- |
| `npm run dev`          | Start the development server                          |
| `npm run build`        | Create the production build in `dist/`                |
| `npm run preview`      | Preview the production build locally                  |
| `npm run lint`         | Check JavaScript with ESLint                          |
| `npm run lint:fix`     | Apply automatic lint fixes                            |
| `npm run format`       | Format supported files with Prettier                  |
| `npm run format:check` | Check formatting                                      |
| `npm test`             | Run deployment integration tests                      |
| `npm run check`        | Run lint, formatting, tests, and build                |
| `npm run deploy`       | Validate, build, and publish to the deployment branch |

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
      lib/                 Board and piece logic
      ui/                  Board setup and game interactions
    sass/                  Styles and font declarations
    pieces/                Chess piece SVGs
    fonts/                 Local chess font
scripts/                   Node/Git deployment utility
tests/                    Deployment integration tests
server.py                  Optional Flask matchmaking service
utils.py                   Backend peer activity helpers
vite.config.js             Build inputs, base path, and @ alias
```

The `@` import alias points to `src/`. Additional HTML files under `pages/` are automatically included in the build. jQuery and jQuery UI are bundled locally; piece artwork and fonts are processed by Vite.

## Configuration

Defaults work without an environment file. To customize them:

```bash
cp .env.example .env
```

| Variable          | Default                            | Purpose                          |
| ----------------- | ---------------------------------- | -------------------------------- |
| `BASE_PATH`       | `/`                                | Public URL prefix for the app    |
| `VITE_SERVER_URL` | `https://gungi.pythonanywhere.com` | Matchmaking service URL          |
| `DEPLOY_REMOTE`   | `origin`                           | Git remote used for deployment   |
| `DEPLOY_BRANCH`   | `gh-pages`                         | Branch used to publish the build |

Restart the development server after changing environment files. Browser-facing `VITE_*` values are public and embedded at build time.

### Optional local matchmaking service

The Python backend tracks available peers; PeerJS handles the peer connection separately. To run the backend in an isolated environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install Flask Flask-Cors
python server.py
```

Set `VITE_SERVER_URL=http://127.0.0.1:5000` in `.env`, then restart Vite. The backend runs separately from the frontend and is not included in `dist/`.

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
