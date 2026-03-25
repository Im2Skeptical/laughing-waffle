# laughing-waffle
IdleCiv Game Prototype

## Status
Archived playable baseline as of 2026-03-25.

- Verified archive tag: `pre-prototype-archive`
- Current GitHub Pages URL: `https://im2skeptical.github.io/laughing-waffle/`
- New prototype work has been split into a separate repo/workspace: `../laughing-waffle-proto`

## Local Run
`npx live-server`

## Install
`npm ci`

## Verify
`npm run verify`

## Strict Env Def Validation
`set STRICT_ENV_DEFS=1 && npm run test`

## Debug Checks
- Determinism: `window.__DBG__.test()`
- Check state: `window.__DBG__.getCursorState()`

## Mobile Playtest With GitHub Pages

### One-time setup
1. Open `https://github.com/Im2Skeptical/laughing-waffle`.
2. Go to `Settings` -> `Pages`.
3. Under `Build and deployment`, set:
- `Source`: `Deploy from a branch`
- `Branch`: `main`
- `Folder`: `/(root)`
4. Save.
5. Wait for initial deployment.
6. Open: `https://im2skeptical.github.io/laughing-waffle/`

### Per playtest cycle
1. Commit changes on your working branch.
2. Run `npm run verify`.
3. Merge to `main`.
4. Push `main`.
5. Wait about 1-3 minutes for Pages to publish.
6. Open the Pages URL on phone and playtest.

### Mobile behavior notes
- The game keeps its existing landscape canvas design.
- There is no portrait warning overlay.
- Portrait still renders, but UI may be small.
- Best playtest mode is physical landscape orientation.

### Quick troubleshooting
- Blank screen or missing art usually means a bad absolute path. Ensure paths use `./src/...` and `images/...`.
- If phone shows old build, hard refresh or clear site data.
- If drag/tap feels wrong, reopen in landscape and ensure browser gesture handling is not interfering.
