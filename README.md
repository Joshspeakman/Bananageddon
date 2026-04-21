# Bananageddon

Browser-based rooftop banana artillery inspired by QBasic Gorillas. The server owns match state, physics, scoring, lobby rules, and reconnect windows; the client handles rendering, audio, HUD, and input.

## Install

```bash
npm install
```

## Run

```bash
npm start
```

Override the port if needed:

```bash
PORT=3012 npm start
```

The server prints `localhost` and LAN URLs. Open one of those URLs in a browser and share it with the other players on your network.

## Lobby Rules

- The first player is the host.
- The host owns all synced match settings.
- The lobby auto-starts as soon as the selected mode has enough connected players.
- If more players are connected than the selected mode supports, the server blocks the start and sends an error to the whole lobby.
- During an active round, only reconnecting players may rejoin. Brand-new joins are rejected until the match returns to `waiting` or `matchOver`.
- Active-match reconnects are token-based and remain valid for 60 seconds after disconnect.

## Mode Matrix

| Mode | Players | Notes |
|------|---------|-------|
| `classic` | 2 | First to `roundsToWin`. |
| `bestof` | 2 | `roundsToWin` becomes series length; tied series extend until there is a unique leader. |
| `suddendeath` | 2 | One hit ends the match. |
| `artillery` | 2 | Three shots per turn. |
| `chaos` | 2 | Wind randomizes during flight. |
| `targetpractice` | 1 | Solo mode against a target gorilla. |
| `gauntlet` | 1 | Solo mode with cycling biome/weather/time rules and escalating wind. |
| `koth` | 2-4 | Free-for-all rotation across all connected active players. |
| `team` | 4 | Fixed 2v2 with Blue Team / Gold Team scoring. |

## Controls

- Title/setup: `Enter` hosts, joins, or syncs setup changes back to the lobby.
- Playing: use the UI fields for angle and power, then fire with the button or `Enter`.
- Playing: `T` opens chat, `M` toggles music, `P` or `Esc` pauses.
- Match over: host can use `R` for rematch and `N` for new match; everyone can use `Esc` to return to title.
- Turrets: each player gets two turret deployments per match and can select them from the ammo controls when charges remain.

## Development

Key files:

- `shared.js`: shared mode/settings definitions used by both client and server
- `server.js`: authoritative lobby, match, scoring, and physics logic
- `game.js`: client renderer, HUD, setup flow, and audio/input handling
- `tests/server-regression.js`: end-to-end server regression coverage

Run the regression suite with:

```bash
npm test
```

Current automated coverage includes:

- `/status` and `/shared.js` smoke checks
- solo `targetpractice` auto-start
- 4-player `team` start payloads
- over-capacity lobby blocking
- rejecting brand-new joins during active play
- host-only `clearMatch` enforcement

## Limitations

- One server process hosts one match at a time; there are no rooms.
- No AI opponent or bot fill.
- Intended for desktop browsers.
- Internet play is possible only if you handle networking yourself, such as port forwarding or a reverse proxy.
