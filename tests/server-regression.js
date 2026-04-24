const assert = require('assert');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_TIMEOUT_MS = 5000;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(err => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function httpRequest(port, reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: reqPath,
        method: 'GET',
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function startServer(envOverrides = {}) {
  const port = await getFreePort();
  const proc = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), ...envOverrides },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const appendOutput = (chunk) => {
    output += chunk.toString();
  };
  proc.stdout.on('data', appendOutput);
  proc.stderr.on('data', appendOutput);

  const startedAt = Date.now();
  while (Date.now() - startedAt < DEFAULT_TIMEOUT_MS) {
    if (proc.exitCode != null) {
      throw new Error(`Server exited early with code ${proc.exitCode}\n${output}`);
    }

    try {
      const status = await httpRequest(port, '/status');
      if (status.statusCode === 200) {
        return { port, proc, output: () => output };
      }
    } catch (err) {
      // Server is still starting.
    }

    await delay(50);
  }

  proc.kill('SIGKILL');
  throw new Error(`Server did not become ready in time\n${output}`);
}

async function stopServer(server) {
  if (!server || !server.proc || server.proc.exitCode != null) return;

  server.proc.kill('SIGINT');
  const startedAt = Date.now();
  while (Date.now() - startedAt < 3000) {
    if (server.proc.exitCode != null) return;
    await delay(25);
  }

  server.proc.kill('SIGKILL');
}

async function withServer(run, options = {}) {
  const server = await startServer(options.env || {});
  try {
    await run(server);
  } finally {
    await stopServer(server);
  }
}

class Client {
  constructor(port, name, token) {
    this.port = port;
    this.name = name;
    this.token = token;
    this.messages = [];
    this.waiters = [];
    this.ws = null;
  }

  static async connect(port, name, token) {
    const client = new Client(port, name, token);
    await client.connect();
    return client;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${this.port}/ws`);
      this.ws = ws;

      const onOpen = () => {
        const joinMsg = { type: 'join', name: this.name };
        if (this.token) joinMsg.token = this.token;
        ws.send(JSON.stringify(joinMsg));
        resolve();
      };

      const onError = (err) => {
        reject(err);
      };

      ws.once('open', onOpen);
      ws.once('error', onError);
      ws.on('message', (buf) => this._handleMessage(JSON.parse(buf.toString())));
    });
  }

  _handleMessage(msg) {
    this.messages.push(msg);

    for (const waiter of [...this.waiters]) {
      const matches = waiter.predicate(msg);
      if (!matches) continue;

      this.waiters = this.waiters.filter(item => item !== waiter);
      clearTimeout(waiter.timer);

      if (waiter.expectNone) {
        waiter.reject(new Error(`${this.name} received unexpected ${waiter.description}: ${JSON.stringify(msg)}`));
      } else {
        waiter.resolve(msg);
      }
    }
  }

  waitFor(predicate, options = {}) {
    const {
      fromIndex = 0,
      timeout = DEFAULT_TIMEOUT_MS,
      description = 'message',
    } = options;

    for (let i = fromIndex; i < this.messages.length; i++) {
      if (predicate(this.messages[i])) return Promise.resolve(this.messages[i]);
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        description,
        expectNone: false,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter(item => item !== waiter);
          reject(new Error(`${this.name} timed out waiting for ${description}. Seen: ${this.messages.map(msg => msg.type).join(', ')}`));
        }, timeout),
      };
      this.waiters.push(waiter);
    });
  }

  waitForType(type, options = {}) {
    return this.waitFor(msg => msg.type === type, { ...options, description: options.description || type });
  }

  expectNo(predicate, options = {}) {
    const {
      fromIndex = this.messages.length,
      timeout = 1000,
      description = 'message',
    } = options;

    for (let i = fromIndex; i < this.messages.length; i++) {
      if (predicate(this.messages[i])) {
        return Promise.reject(new Error(`${this.name} already received unexpected ${description}: ${JSON.stringify(this.messages[i])}`));
      }
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        description,
        expectNone: true,
        resolve: () => {},
        reject,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter(item => item !== waiter);
          resolve();
        }, timeout),
      };
      this.waiters.push(waiter);
    });
  }

  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  async close() {
    if (!this.ws) return;
    const ws = this.ws;
    if (ws.readyState === WebSocket.CLOSED) return;

    await new Promise((resolve) => {
      const onClose = () => resolve();
      ws.once('close', onClose);
      try {
        ws.close();
      } catch (err) {
        resolve();
      }
      setTimeout(resolve, 250);
    });
  }
}

async function testStatusAndSharedRoute() {
  await withServer(async ({ port }) => {
    const status = await httpRequest(port, '/status');
    assert.strictEqual(status.statusCode, 200);
    const parsed = JSON.parse(status.body);
    assert.strictEqual(parsed.active, false);
    assert.strictEqual(parsed.state, 'waiting');
    assert.strictEqual(parsed.gameMode, 'classic');
    assert.strictEqual(parsed.mapSize, 'normal');

    const shared = await httpRequest(port, '/shared.js');
    assert.strictEqual(shared.statusCode, 200);
    assert.match(shared.body, /MODE_CONFIGS/);
    assert.match(shared.body, /targetpractice/);
    assert.match(shared.body, /team/);
  });
}

async function testSoloTargetPracticeAutoStart() {
  await withServer(async ({ port }) => {
    const host = await Client.connect(port, 'Host Solo');
    try {
      await host.waitForType('waiting');
      const marker = host.messages.length;
      host.send({ type: 'setSettings', gameMode: 'targetpractice' });

      const assigned = await host.waitForType('assigned', { fromIndex: marker });
      const roundStart = await host.waitFor(
        msg => msg.type === 'roundStart' && msg.mode === 'targetpractice',
        { fromIndex: marker, description: 'target practice roundStart' }
      );

      assert.strictEqual(assigned.player, 1);
      assert.strictEqual(roundStart.currentPlayer, 1);
      assert.deepStrictEqual(roundStart.scores, [0]);
      assert.strictEqual(roundStart.playerNames.length, 1);
      assert.strictEqual(roundStart.gorillas.length, 2);
    } finally {
      await host.close();
    }
  });
}

async function testTeamModeStartsWithFourPlayers() {
  await withServer(async ({ port }) => {
    const host = await Client.connect(port, 'Host');
    const clients = [host];

    try {
      await host.waitForType('waiting');
      const teamMarker = host.messages.length;
      host.send({ type: 'setSettings', gameMode: 'team' });
      await host.waitFor(
        msg => msg.type === 'settingsSync' && msg.settings && msg.settings.gameMode === 'team',
        { fromIndex: teamMarker, description: 'team settingsSync' }
      );

      for (const name of ['P2', 'P3', 'P4']) {
        clients.push(await Client.connect(port, name));
      }

      const assigned = await Promise.all(
        clients.map(client => client.waitForType('assigned'))
      );
      const rounds = await Promise.all(
        clients.map(client => client.waitFor(
          msg => msg.type === 'roundStart' && msg.mode === 'team',
          { description: 'team roundStart' }
        ))
      );

      assert.deepStrictEqual(
        assigned.map(msg => msg.player).sort((a, b) => a - b),
        [1, 2, 3, 4]
      );

      for (const round of rounds) {
        assert.deepStrictEqual(round.scores, [0, 0, 0, 0]);
        assert.deepStrictEqual(round.playerTeams, [0, 1, 0, 1]);
        assert.deepStrictEqual(round.playerNames, ['Host', 'P2', 'P3', 'P4']);
      }
    } finally {
      await Promise.all(clients.map(client => client.close()));
    }
  });
}

async function testLobbyOverCapacityBlocksStart() {
  await withServer(async ({ port }) => {
    const host = await Client.connect(port, 'Host');
    const clients = [host];

    try {
      await host.waitForType('waiting');
      host.send({ type: 'setSettings', gameMode: 'team' });
      clients.push(await Client.connect(port, 'P2'));
      clients.push(await Client.connect(port, 'P3'));
      await host.waitFor(
        msg => msg.type === 'waiting' && msg.mode === 'team' && msg.connectedPlayers === 3,
        { description: '3-player team lobby' }
      );

      const markers = new Map(clients.map(client => [client, client.messages.length]));
      host.send({ type: 'setSettings', gameMode: 'classic' });

      await Promise.all(
        clients.map(client => client.waitFor(
          msg => msg.type === 'error' && /supports up to 2 players/i.test(msg.message),
          { fromIndex: markers.get(client), description: 'over-capacity lobby error' }
        ))
      );

      await Promise.all(
        clients.map(client => client.expectNo(
          msg => msg.type === 'roundStart',
          {
            fromIndex: markers.get(client),
            timeout: 1200,
            description: 'roundStart while lobby is over capacity',
          }
        ))
      );
    } finally {
      await Promise.all(clients.map(client => client.close()));
    }
  });
}

async function testRejectJoinWhilePlaying() {
  await withServer(async ({ port }) => {
    const host = await Client.connect(port, 'Host Solo');
    let intruder = null;

    try {
      await host.waitForType('waiting');
      const marker = host.messages.length;
      host.send({ type: 'setSettings', gameMode: 'targetpractice' });
      await host.waitFor(
        msg => msg.type === 'roundStart' && msg.mode === 'targetpractice',
        { fromIndex: marker, description: 'solo roundStart' }
      );

      intruder = await Client.connect(port, 'Late Joiner');
      const joinError = await intruder.waitFor(
        msg => msg.type === 'error' && /match already in progress/i.test(msg.message),
        { description: 'join-in-progress error' }
      );

      assert.match(joinError.message, /match already in progress/i);
    } finally {
      await Promise.all([host.close(), intruder ? intruder.close() : Promise.resolve()]);
    }
  });
}

async function testGuestCannotClearMatch() {
  await withServer(async ({ port }) => {
    const host = await Client.connect(port, 'Host');
    const guest = await Client.connect(port, 'Guest');

    try {
      await host.waitForType('waiting');
      host.send({ type: 'setSettings', gameMode: 'team' });
      await guest.waitFor(
        msg => msg.type === 'waiting' && msg.mode === 'team',
        { description: 'guest team waiting state' }
      );

      const guestMarker = guest.messages.length;
      const hostMarker = host.messages.length;
      guest.send({ type: 'clearMatch' });

      const error = await guest.waitFor(
        msg => msg.type === 'error' && /only the host can clear the match/i.test(msg.message),
        { fromIndex: guestMarker, description: 'guest clearMatch rejection' }
      );

      assert.match(error.message, /only the host can clear the match/i);
      await host.expectNo(
        msg => msg.type === 'matchCleared',
        { fromIndex: hostMarker, timeout: 800, description: 'unexpected matchCleared broadcast' }
      );
    } finally {
      await Promise.all([host.close(), guest.close()]);
    }
  });
}

async function testWaitingReconnectKeepsReservedSlot() {
  await withServer(async ({ port }) => {
    const host = await Client.connect(port, 'Host');
    const hostAssigned = await host.waitForType('assigned');
    await host.waitForType('waiting');

    const teamMarker = host.messages.length;
    host.send({ type: 'setSettings', gameMode: 'team' });
    await host.waitFor(
      msg => msg.type === 'settingsSync' && msg.settings && msg.settings.gameMode === 'team',
      { fromIndex: teamMarker, description: 'host team settingsSync' }
    );

    const guest = await Client.connect(port, 'Guest');
    const guestAssigned = await guest.waitForType('assigned');
    assert.strictEqual(guestAssigned.player, 2);
    await guest.waitFor(
      msg => msg.type === 'waiting' && msg.mode === 'team',
      { description: 'guest team waiting state' }
    );

    try {
      const guestMarker = guest.messages.length;
      await host.close();
      await guest.waitFor(
        msg => msg.type === 'waiting' && msg.connectedPlayers === 1 && msg.hostPlayer === 1,
        { fromIndex: guestMarker, description: 'guest waiting after host disconnect' }
      );

      const intruder = await Client.connect(port, 'Intruder');
      const intruderAssigned = await intruder.waitForType('assigned');
      assert.strictEqual(intruderAssigned.player, 3);

      const hostReconnect = await Client.connect(port, 'Host', hostAssigned.token);
      const reconnectAssigned = await hostReconnect.waitForType('assigned');
      assert.strictEqual(reconnectAssigned.player, 1);
      assert.strictEqual(reconnectAssigned.hostPlayer, 1);

      await Promise.all([intruder.close(), hostReconnect.close()]);
    } finally {
      await guest.close();
    }
  });
}

async function testHostPromotionAfterTimeout() {
  await withServer(async ({ port }) => {
    const host = await Client.connect(port, 'Host');
    await host.waitForType('assigned');
    await host.waitForType('waiting');
    host.send({ type: 'setSettings', gameMode: 'team' });
    await host.waitFor(
      msg => msg.type === 'settingsSync' && msg.settings && msg.settings.gameMode === 'team',
      { description: 'team settingsSync before timeout' }
    );

    const guest = await Client.connect(port, 'Guest');
    await guest.waitForType('assigned');
    await guest.waitFor(
      msg => msg.type === 'waiting' && msg.mode === 'team',
      { description: 'guest waiting before timeout' }
    );

    try {
      const guestMarker = guest.messages.length;
      await host.close();
      await guest.waitFor(
        msg => msg.type === 'waiting' && msg.connectedPlayers === 1,
        { fromIndex: guestMarker, description: 'guest waiting after host disconnect' }
      );

      const promoteMarker = guest.messages.length;
      await guest.waitFor(
        msg => msg.type === 'waiting' && msg.hostPlayer === 2,
        { fromIndex: promoteMarker, timeout: 1500, description: 'host promotion waiting state' }
      );

      const settingsMarker = guest.messages.length;
      guest.send({ type: 'setSettings', mapSize: 'large' });
      const settingsSync = await guest.waitFor(
        msg => msg.type === 'settingsSync' && msg.settings && msg.settings.mapSize === 'large',
        { fromIndex: settingsMarker, description: 'promoted host settingsSync' }
      );
      assert.strictEqual(settingsSync.settings.mapSize, 'large');
    } finally {
      await guest.close();
    }
  }, { env: { DISCONNECT_TIMEOUT_MS: '250' } });
}

async function testStatusReportsReservedReconnectSlots() {
  await withServer(async ({ port }) => {
    const host = await Client.connect(port, 'Host');
    await host.waitForType('assigned');
    await host.waitForType('waiting');
    host.send({ type: 'setSettings', gameMode: 'team' });
    await host.waitFor(
      msg => msg.type === 'settingsSync' && msg.settings && msg.settings.gameMode === 'team',
      { description: 'team settingsSync for status test' }
    );

    const guest = await Client.connect(port, 'Guest');
    await guest.waitForType('assigned');
    await guest.waitFor(
      msg => msg.type === 'waiting' && msg.mode === 'team',
      { description: 'guest waiting for status test' }
    );

    try {
      await host.close();
      await delay(100);
      const status = await httpRequest(port, '/status');
      const parsed = JSON.parse(status.body);
      assert.strictEqual(parsed.active, true);
      assert.strictEqual(parsed.connectedPlayerCount, 1);
      assert.strictEqual(parsed.reservedPlayerCount, 1);
      assert.ok(parsed.playerNames.includes('Host'));
      assert.ok(parsed.playerNames.includes('Guest'));
      assert.strictEqual(parsed.hostPlayer, 1);
    } finally {
      await guest.close();
    }
  });
}

async function testReconnectStateSyncPreservesTurnRemaining() {
  await withServer(async ({ port }) => {
    const host = await Client.connect(port, 'Host Solo');
    const assigned = await host.waitForType('assigned');

    try {
      await host.waitForType('waiting');
      const marker = host.messages.length;
      host.send({ type: 'setSettings', gameMode: 'targetpractice', turnTimer: 15 });
      await host.waitFor(
        msg => msg.type === 'roundStart' && msg.mode === 'targetpractice',
        { fromIndex: marker, description: 'target practice roundStart with timer' }
      );

      await delay(2100);
      await host.close();

      const reconnect = await Client.connect(port, 'Host Solo', assigned.token);
      const reconnectAssigned = await reconnect.waitForType('assigned');
      const stateSync = await reconnect.waitFor(
        msg => msg.type === 'stateSync' && msg.state === 'playing',
        { description: 'playing stateSync after reconnect' }
      );

      assert.strictEqual(reconnectAssigned.player, 1);
      assert.strictEqual(stateSync.hostPlayer, 1);
      assert.ok(stateSync.turnRemainingMs > 9000, `expected remaining time above 9s, got ${stateSync.turnRemainingMs}`);
      assert.ok(stateSync.turnRemainingMs < 15000, `expected remaining time below full turn, got ${stateSync.turnRemainingMs}`);

      await reconnect.close();
    } finally {
      await host.close();
    }
  });
}

async function testPauseStateFreezesTurnTimerAndBlocksFire() {
  await withServer(async ({ port }) => {
    const host = await Client.connect(port, 'Host');
    let guest = null;

    try {
      await host.waitForType('waiting');
      const settingsMarker = host.messages.length;
      host.send({ type: 'setSettings', turnTimer: 15 });
      await host.waitFor(
        msg => msg.type === 'settingsSync' && msg.settings && msg.settings.turnTimer === 15,
        { fromIndex: settingsMarker, description: 'turn timer settingsSync before pause test' }
      );

      guest = await Client.connect(port, 'Guest');
      await Promise.all([
        host.waitFor(msg => msg.type === 'roundStart' && msg.mode === 'classic', { description: 'host classic roundStart' }),
        guest.waitFor(msg => msg.type === 'roundStart' && msg.mode === 'classic', { description: 'guest classic roundStart' }),
      ]);

      await delay(1200);

      const pauseHostMarker = host.messages.length;
      const pauseGuestMarker = guest.messages.length;
      host.send({ type: 'setPaused', paused: true });

      const [hostPaused, guestPaused] = await Promise.all([
        host.waitFor(msg => msg.type === 'pauseState' && msg.paused === true, {
          fromIndex: pauseHostMarker,
          description: 'host pauseState broadcast',
        }),
        guest.waitFor(msg => msg.type === 'pauseState' && msg.paused === true, {
          fromIndex: pauseGuestMarker,
          description: 'guest pauseState broadcast',
        }),
      ]);

      assert.strictEqual(hostPaused.pausedByPlayer, 1);
      assert.strictEqual(guestPaused.pausedByName, 'Host');
      assert.ok(hostPaused.turnRemainingMs > 10000, `expected paused timer above 10s, got ${hostPaused.turnRemainingMs}`);

      const noThrowHost = host.expectNo(
        msg => msg.type === 'throwAnim',
        { fromIndex: host.messages.length, timeout: 800, description: 'throwAnim while paused for host' }
      );
      const noThrowGuest = guest.expectNo(
        msg => msg.type === 'throwAnim',
        { fromIndex: guest.messages.length, timeout: 800, description: 'throwAnim while paused for guest' }
      );

      host.send({ type: 'fire', angle: 45, velocity: 60 });
      await Promise.all([noThrowHost, noThrowGuest]);

      await delay(1200);

      const resumeHostMarker = host.messages.length;
      const resumeGuestMarker = guest.messages.length;
      guest.send({ type: 'setPaused', paused: false });

      const [hostResumed, guestResumed] = await Promise.all([
        host.waitFor(msg => msg.type === 'pauseState' && msg.paused === false, {
          fromIndex: resumeHostMarker,
          description: 'host resume pauseState broadcast',
        }),
        guest.waitFor(msg => msg.type === 'pauseState' && msg.paused === false, {
          fromIndex: resumeGuestMarker,
          description: 'guest resume pauseState broadcast',
        }),
      ]);

      assert.ok(
        hostResumed.turnRemainingMs >= hostPaused.turnRemainingMs - 500,
        `expected resume timer to stay near paused value (${hostPaused.turnRemainingMs}), got ${hostResumed.turnRemainingMs}`
      );
      assert.strictEqual(guestResumed.paused, false);
    } finally {
      await Promise.all([host.close(), guest ? guest.close() : Promise.resolve()]);
    }
  });
}

async function testLeaveMatchReturnsOpponentToLobby() {
  await withServer(async ({ port }) => {
    const host = await Client.connect(port, 'Host');
    const guest = await Client.connect(port, 'Guest');

    try {
      await Promise.all([
        host.waitFor(msg => msg.type === 'roundStart' && msg.mode === 'classic', { description: 'host roundStart before leave' }),
        guest.waitFor(msg => msg.type === 'roundStart' && msg.mode === 'classic', { description: 'guest roundStart before leave' }),
      ]);

      const hostMarker = host.messages.length;
      const guestMarker = guest.messages.length;
      host.send({ type: 'leaveMatch' });

      const leftMatch = await host.waitFor(
        msg => msg.type === 'leftMatch',
        { fromIndex: hostMarker, description: 'leftMatch acknowledgement' }
      );
      const opponentLeft = await guest.waitFor(
        msg => msg.type === 'opponentLeft' && msg.playerName === 'Host',
        { fromIndex: guestMarker, description: 'opponentLeft after leaveMatch' }
      );
      const waiting = await guest.waitFor(
        msg => msg.type === 'waiting' && msg.connectedPlayers === 1,
        { fromIndex: guestMarker, description: 'waiting state after opponent leaves' }
      );

      assert.strictEqual(leftMatch.type, 'leftMatch');
      assert.strictEqual(opponentLeft.playerName, 'Host');
      assert.strictEqual(waiting.connectedPlayers, 1);
      assert.strictEqual(waiting.hostPlayer, 2);
    } finally {
      await Promise.all([host.close(), guest.close()]);
    }
  });
}

const TESTS = [
  ['status and shared route', testStatusAndSharedRoute],
  ['solo target practice auto-start', testSoloTargetPracticeAutoStart],
  ['team mode starts with four players', testTeamModeStartsWithFourPlayers],
  ['over-capacity lobby is blocked', testLobbyOverCapacityBlocksStart],
  ['late join is rejected while playing', testRejectJoinWhilePlaying],
  ['guest cannot clear the match', testGuestCannotClearMatch],
  ['waiting reconnect keeps reserved slot', testWaitingReconnectKeepsReservedSlot],
  ['host promotion after timeout', testHostPromotionAfterTimeout],
  ['status reports reserved reconnect slots', testStatusReportsReservedReconnectSlots],
  ['reconnect state sync preserves turn remaining', testReconnectStateSyncPreservesTurnRemaining],
  ['pause freezes timer and blocks fire', testPauseStateFreezesTurnTimerAndBlocksFire],
  ['leave match returns opponent to lobby', testLeaveMatchReturnsOpponentToLobby],
];

async function main() {
  let failures = 0;

  for (const [name, test] of TESTS) {
    try {
      await test();
      console.log(`PASS ${name}`);
    } catch (err) {
      failures++;
      console.error(`FAIL ${name}`);
      console.error(err && err.stack ? err.stack : err);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
    return;
  }

  console.log(`PASS ${TESTS.length} tests`);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
