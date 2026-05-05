// Electron launcher for Bananageddon.
//
// Forks server.js as a child Node process bound to an OS-picked free port,
// waits for its IPC "listening" handshake, then opens a BrowserWindow
// pointed at http://127.0.0.1:<port>/.
//
// The packaged app contains the entire server (server.js, shared.js, ws,
// etc.), so when the user double-clicks the launcher they get the full
// game with no separate server step. LAN multiplayer still works: other
// players on the network can point their browser at the host machine's
// printed http://<lan-ip>:<port> URL.

const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let serverProc = null;
let mainWindow = null;

function startServer() {
  return new Promise((resolve, reject) => {
    // In dev: __dirname = .../electron, server.js is one level up.
    // In packaged app: same relative layout under app.asar.
    const serverPath = path.join(__dirname, '..', 'server.js');
    serverProc = fork(serverPath, [], {
      env: {
        ...process.env,
        PORT: '0',                // let OS pick a free port
        NODE_ENV: 'production',
      },
      // 'inherit' lets the server log show up in the terminal when running
      // `npm run electron`; in packaged builds these go nowhere harmless.
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });

    let resolved = false;
    const onMessage = (msg) => {
      if (resolved) return;
      if (msg && msg.type === 'listening' && typeof msg.port === 'number') {
        resolved = true;
        serverProc.off('message', onMessage);
        resolve(msg.port);
      }
    };

    serverProc.on('message', onMessage);
    serverProc.on('error', (err) => {
      if (!resolved) { resolved = true; reject(err); }
    });
    serverProc.on('exit', (code, signal) => {
      console.error(`[launcher] server exited code=${code} signal=${signal}`);
      if (!resolved) { resolved = true; reject(new Error(`Server exited code=${code}`)); }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.destroy();
      }
    });

    // Hard timeout in case the server hangs before listening.
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error('Server startup timed out (10s)'));
      }
    }, 10000);
  });
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#0f1c18',
    title: 'Bananageddon',
    icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Hide the default OS menu bar entirely; the in-game UI provides everything.
  Menu.setApplicationMenu(null);

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);

  // External links (e.g. share buttons) should open in the user's real browser
  // rather than inside the game window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function killServer() {
  if (serverProc && !serverProc.killed) {
    try { serverProc.kill(); } catch (_) { /* ignore */ }
  }
  serverProc = null;
}

app.whenReady().then(async () => {
  try {
    const port = await startServer();
    createWindow(port);
  } catch (err) {
    console.error('[launcher] failed to start server:', err);
    dialog.showErrorBox('Bananageddon failed to start', String(err && err.message || err));
    app.quit();
  }
});

app.on('window-all-closed', () => {
  killServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', killServer);
app.on('will-quit', killServer);
