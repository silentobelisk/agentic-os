// Minimal preload. All privileged work (filesystem, spawning `claude`) lives in
// the Next route handlers on the server side, so the renderer needs no Node or
// IPC surface — we only expose a tiny read-only version tag. contextIsolation
// stays on; nodeIntegration stays off.

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("agenticOS", {
  desktop: true,
  electron: process.versions.electron,
});
