const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['game.js', 'background.js', 'lighting.js', 'particles.js', 'net.js', 'shared.js', 'server.js', 'electron/main.js'];

let failures = 0;

for (const file of FILES) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  if (result.status === 0) {
    console.log(`PASS syntax ${file}`);
    continue;
  }

  failures++;
  console.error(`FAIL syntax ${file}`);
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

if (failures > 0) {
  process.exitCode = 1;
}
