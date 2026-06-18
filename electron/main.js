// Electron main process for Agentic OS / Nerve Center.
//
// The app depends on a live Node server (every Next route handler reads the
// filesystem and spawns the `claude` CLI), so we don't static-export — we run
// the standalone Next server as a child process and point a BrowserWindow at
// it once it's listening on loopback.

const { app, BrowserWindow, shell, dialog } = require("electron");
const { fork } = require("node:child_process");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

let serverProc = null;
let win = null;
let serverPort = 3000;

// ── PATH repair ────────────────────────────────────────────────────────────
// A Finder-launched .app inherits a minimal PATH (often just /usr/bin:/bin),
// so spawned `claude` / `open` won't resolve. Prepend the usual install dirs.
function repairPath() {
  const home = os.homedir();
  const extra = [
    path.join(home, ".npm-global", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".local", "bin"),
    path.join(home, ".bun", "bin"),
  ];
  const current = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const merged = [...extra, ...current].filter((p, i, a) => a.indexOf(p) === i);
  process.env.PATH = merged.join(path.delimiter);
}

// ── free loopback port ───────────────────────────────────────────────────
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// ── start the bundled standalone Next server (packaged builds only) ────────
async function startServer() {
  serverPort = await findFreePort();
  // electron-builder copies .next/standalone → Resources/app (see package.json
  // build.extraResources). server.js binds PORT/HOSTNAME from the environment.
  const serverDir = path.join(process.resourcesPath, "app");
  const serverJs = path.join(serverDir, "server.js");
  serverProc = fork(serverJs, [], {
    cwd: serverDir,
    env: {
      ...process.env,
      // Run the child as plain Node. Without this, child_process.fork() reuses
      // process.execPath — which in a packaged app is the Electron binary — and
      // would relaunch this whole app instead of running server.js.
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(serverPort),
      HOSTNAME: "127.0.0.1", // loopback only — never expose this console to the LAN
      NODE_ENV: "production",
    },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  serverProc.on("exit", (code) => {
    serverProc = null;
    if (code && !app.isQuitting) app.quit();
  });
}

// ── wait until the server answers ──────────────────────────────────────────
function waitForServer(url, retries = 80) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const req = http.get(url, () => resolve()); // any response means it's up
      req.on("error", () => {
        if (n <= 0) reject(new Error("Next server did not start in time"));
        else setTimeout(() => attempt(n - 1), 150);
      });
      req.setTimeout(1000, () => req.destroy());
    };
    attempt(retries);
  });
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1340,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#0a0a0b",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  // open target=_blank / external links in the system browser, not a new window
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:/.test(u)) shell.openExternal(u);
    return { action: "deny" };
  });
  // keep the top-level frame pinned to our loopback origin; send anything else
  // to the system browser (defense-in-depth against a redirecting route).
  win.webContents.on("will-navigate", (e, u) => {
    if (!u.startsWith(`http://127.0.0.1:${serverPort}/`)) {
      e.preventDefault();
      if (/^https?:/.test(u)) shell.openExternal(u);
    }
  });
  win.on("closed", () => {
    win = null;
  });
  win.loadURL(url);
}

async function boot() {
  repairPath();
  const dev = !app.isPackaged;
  if (dev) {
    // `npm run electron:dev` runs `next dev` on :3000 concurrently.
    serverPort = Number(process.env.NEXT_DEV_PORT) || 3000;
  } else {
    await startServer();
  }
  const url = `http://127.0.0.1:${serverPort}/`;
  try {
    await waitForServer(url);
  } catch (err) {
    console.error(err);
    if (app.isPackaged) {
      // Don't open a window onto a dead port (ERR_CONNECTION_REFUSED with no
      // explanation) — tell the user and exit cleanly.
      dialog.showErrorBox("Agentic OS", "The local engine didn't start. Please relaunch the app.");
      app.quit();
      return;
    }
  }
  createWindow(url);
}

app.whenReady().then(boot);

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length > 0) return;
  // The server is kept alive across window closes on macOS, but restart it if
  // it died (crash) so re-opening from the dock never lands on a dead port.
  if (app.isPackaged && !serverProc) {
    await startServer();
    try {
      await waitForServer(`http://127.0.0.1:${serverPort}/`);
    } catch (err) {
      console.error(err);
    }
  }
  createWindow(`http://127.0.0.1:${serverPort}/`);
});

function shutdown() {
  app.isQuitting = true;
  if (serverProc) {
    const proc = serverProc;
    serverProc = null;
    try {
      proc.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    // hard-kill if it doesn't exit promptly so it can't keep holding the port
    const t = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, 2000);
    if (typeof t.unref === "function") t.unref();
  }
}

app.on("before-quit", shutdown);
app.on("window-all-closed", () => {
  // On macOS, keep the app (and the Next server) running so a dock reactivate
  // can reopen instantly; on other platforms, quitting is expected.
  if (process.platform !== "darwin") {
    shutdown();
    app.quit();
  }
});
process.on("exit", shutdown);
