# AI Codebase Reference — Bananageddon

Reference for working on the current implementation, not the historical design target. This file is intentionally aligned with what the repo does now.

## Snapshot

- Game title: `Bananageddon`
- Directory name on disk: `Monkey Maddness` (legacy)
- Stack: plain HTML/CSS/JS, Node.js, `ws`
- Server model: one global match, server-authoritative physics and scoring
- Shared definitions: `shared.js`
- Verified regression coverage: `tests/server-regression.js`

## Core Files

| File | Purpose |
|------|---------|
| `shared.js` | Shared constants: `MAP_SIZES`, `MODE_CONFIGS`, `DEFAULT_SETTINGS`, `SETTINGS_LIMITS`, `VALID_GAME_MODES` |
| `server.js` | Static file server, `/status`, WebSocket protocol, lobby rules, scoring, physics, reconnect handling |
| `game.js` | Client game state, setup flow, HUD, rendering, audio, input, chat, taunts, match-over UI |
| `net.js` | Minimal WebSocket wrapper for the client |
| `lighting.js` | Lighting, shadows, flashes |
| `particles.js` | Weather and burst particles |
| `background.js` | Biome/time/weather background events |
| `index.html` | Canvas and screen overlays |
| `styles.css` | Retro UI styling and responsive HUD/layout rules |
| `tests/server-regression.js` | End-to-end server regression suite |

## Shared Config Model

`shared.js` is now the source of truth for mode capabilities and default match settings.

Important exports:

- `MODE_CONFIGS[mode].requiredPlayers`
- `MODE_CONFIGS[mode].supportedPlayers`
- `MODE_CONFIGS[mode].controlledPlayers`
- `MODE_CONFIGS[mode].scoreMode`
- `MODE_CONFIGS[mode].soloTurn`
- `MODE_CONFIGS[mode].targetCount`

Do not duplicate mode capability tables in client and server code unless you also update `shared.js`.

## Lobby and Match Rules

### Waiting state

- Host is always slot 1 / player index 0.
- Host-only actions while waiting:
  - `setSettings`
  - `clearMatch`
- The server broadcasts `settingsSync` plus `waiting` lobby updates while the match is in `waiting`.
- If the selected mode supports fewer players than are currently connected, `maybeStartMatchFromWaiting()` refuses to start and broadcasts an `error` to the lobby.

### Playing state

- New non-reconnect joins are rejected with `Match already in progress`.
- Reconnects are allowed when `name` and `token` match a disconnected slot.
- Disconnect grace window is 60 seconds for active matches.
- `broadcast()` sends to all connected players while waiting, but only to the active roster while playing/match-over.

### Match-over state

- Host-only actions:
  - `rematch`
  - `newMatch`
- `newMatch` returns connected clients to setup while keeping sockets open.
- `rematch` resets match counters and starts the same mode again.

## Mode Matrix

| Mode | Required | Supported | Score Mode | Notes |
|------|----------|-----------|------------|-------|
| `classic` | 2 | 2 | individual | Standard round scoring |
| `bestof` | 2 | 2 | individual | `roundsToWin` is treated as series length |
| `suddendeath` | 2 | 2 | individual | First hit ends the match |
| `artillery` | 2 | 2 | individual | Three shots before turn passes |
| `chaos` | 2 | 2 | individual | Wind mutates during flight |
| `targetpractice` | 1 | 1 | individual | Solo turn, one target gorilla |
| `gauntlet` | 1 | 1 | individual | Solo turn, one target gorilla, rotating biome/weather/time and stronger wind as score rises |
| `koth` | 2 | 4 | individual | Rotating free-for-all |
| `team` | 4 | 4 | team | 2v2, Blue Team and Gold Team |

## Server Notes

### Match state helpers

Important helpers in `server.js`:

- `getSupportedPlayerCount()`
- `getRequiredPlayerCount()`
- `getActivePlayerCount()`
- `getRoundGorillaCount()`
- `getDisplayScores()`
- `getTeamScores()`
- `getWinnerLabel()`
- `buildRoundStartPayload()`

### Scoring behavior

- `team` mode still tracks per-player round credits internally, then derives team totals with `getTeamScores()`.
- `bestof` ends on majority or on series completion with a unique leader. Tied series continue.
- Solo self-destruction does not award a point.
- Friendly-fire handling depends on `friendlyFire` and mode-specific fallback winner rules.

### Throw direction

Throw direction is no longer hard-coded to player 1 vs player 2. The server uses gorilla position relative to map center through `getThrowSide()` for both bananas and turret deploys.

### Waiting payloads

`waiting` now includes:

- `player`
- `mode`
- `requiredPlayers`
- `supportedPlayers`
- `connectedPlayers`
- `playerNames`

That is used by the client to keep the waiting screen and setup flow in sync with the lobby.

## Client Notes

### Setup flow

- `switchToSetup()` now loads local preferences first, then re-applies synced server settings when the socket is already connected.
- This avoids clobbering server-owned match settings after `newMatch`.
- Non-host players can view lobby settings in connected setup, but synced controls are disabled. Local-only controls such as music and effects quality stay editable.

### Dynamic player UI

- HUD score cards are rendered dynamically from arrays rather than fixed `P1/P2` DOM slots.
- Match-over score text and stats tables now use dynamic player counts.
- Team mode uses `playerTeams` and `teamScores` from the server payloads.

### Gorilla facing

- Client reaction animation and throw animation now use gorilla position (`getGorillaSide()`) instead of assuming exactly two mirrored players.
- This matters for `team` and `koth`, where the active gorilla can be on either side of the skyline.

### Error handling

- Server `error` messages are appended to chat as `System` messages.
- Waiting-screen status text is updated with lobby-capacity errors.

## Important Message Types

### Client → Server

- `join`
- `setSettings`
- `fire`
- `rematch`
- `newMatch`
- `clearMatch`
- `chat`
- `taunt`
- `picnic`

### Server → Client

- `waiting`
- `assigned`
- `settingsSync`
- `roundStart`
- `turn`
- `throwAnim`
- `banana`
- `explosion`
- `gorillaHit`
- `matchOver`
- `returnToSetup`
- `opponentDisconnected`
- `opponentReconnected`
- `opponentTimedOut`
- `error`

`roundStart`, `gorillaHit`, and `matchOver` now carry enough scoreboard metadata for dynamic-player rendering:

- `playerNames`
- `playerTeams`
- `scoreMode`
- `teamScores`
- `scoreSummary`

## Verified Regression Coverage

The current automated suite verifies:

1. `/status` and `/shared.js`
2. Solo `targetpractice` auto-start from waiting
3. 4-player `team` assignment and `roundStart` payloads
4. Blocking a start when a classic lobby has too many connected players
5. Rejecting brand-new joins during active play
6. Rejecting `clearMatch` from a non-host

Anything outside that list should be treated as less protected and rechecked before large refactors.

## Remaining Gaps / Cautions

- There is still only one match per server process.
- The suite does not currently simulate full match completion, rematch, or reconnect recovery through a finished match.
- The match-over celebration canvas is still a generic two-monkey overlay, not a fully team-aware winner presentation.
- Browser UX around disconnect/reconnect is covered manually rather than by automated browser tests.
