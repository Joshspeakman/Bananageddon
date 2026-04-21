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

async function startServer() {
  const port = await getFreePort();
  const proc = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
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

async function withServer(run) {
  const server = await startServer();
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

const TESTS = [
  ['status and shared route', testStatusAndSharedRoute],
  ['solo target practice auto-start', testSoloTargetPracticeAutoStart],
  ['team mode starts with four players', testTeamModeStartsWithFourPlayers],
  ['over-capacity lobby is blocked', testLobbyOverCapacityBlocksStart],
  ['late join is rejected while playing', testRejectJoinWhilePlaying],
  ['guest cannot clear the match', testGuestCannotClearMatch],
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
