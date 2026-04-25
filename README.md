# Bananageddon

Browser-based rooftop banana artillery inspired by QBasic Gorillas. The server owns match state, physics, scoring, lobby rules, and reconnect windows; the client handles rendering, audio, HUD, and input.

## Visual Refresh

The current build includes a Genesis-inspired art-direction pass without abandoning the original chunky sprite readability.

Highlights:

- Biome-specific stage palettes with harder color ramps
- Chunkier skyline/parallax silhouettes per biome
- Shaded foreground buildings with stronger outlines and roof bands
- Monkey sprites now use the selected "Arcade Hunch" silhouette: hunched shoulders, longer arms, and a squarer arcade-style face while staying chunky
- Gorilla, banana, trail, and explosion sprites tuned toward a louder 16-bit look
- Foreground sun/moon rendering without the doubled background orb artifact
- Terrain twinkles now respect cratered/destroyed building pixels
- Broadcast-style HUD/menu reskin with bolder cartridge-era chrome
- Less misty lighting/particle treatment so the scene stays crisp
- Much denser biome background motion and event activity so every map feels busier

## Install

```bash
npm install
```

Node.js `16.17+` is recommended. The server uses modern runtime APIs such as `crypto.randomUUID()`.

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
- During an active round, only reconnecting players may rejoin as players. Brand-new users can join as spectators.
- Player and spectator reconnects are token-based and remain valid for 15 seconds after disconnect.
- Up to 8 spectators can watch and chat. Spectators can queue a first-come challenge for any player seat; queued challengers claim the target seat after the reconnect window or when the player gives up the seat after match over.
- Host controls follow the current host slot, not always player 1. If the host times out in `waiting`, host rights move to the next connected player.

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
- `game.js`: client renderer, foreground palettes/sprites/effects, HUD, setup flow, and audio/input handling
- `background.js`: stage sky banding, distant biome silhouettes, ambient background events
- `lighting.js`: ambient tint, stepped light falloff, flashes, shimmer, caustics
- `particles.js`: weather, sparks, smoke, confetti, and other pixel-style particles
- `styles.css`: cartridge/broadcast UI skin
- `tests/server-regression.js`: end-to-end server regression coverage

Run the regression suite with:

```bash
npm test
```

That command runs the WebSocket regression suite plus syntax checks for the browser-facing modules.

Current automated coverage includes:

- `/status` and `/shared.js` smoke checks
- solo `targetpractice` auto-start
- 4-player `team` start payloads
- over-capacity lobby blocking
- rejecting brand-new player joins during active play
- spectator join/chat, spectator cap, and challenge-seat promotion
- host-only `clearMatch` enforcement
- preserving reconnect reservations in `waiting`
- promoting a new host after timeout
- `/status` visibility for reserved reconnect slots
- reconnect state sync preserving remaining turn time

## Limitations

- One server process hosts one match at a time; there are no rooms.
- No AI opponent or bot fill.
- Intended for desktop browsers.
- Internet play is possible only if you handle networking yourself, such as port forwarding or a reverse proxy.
- Reconnect tokens are origin-checked server-side, but real transport security still requires HTTPS/WSS if you expose the game outside a trusted LAN.
