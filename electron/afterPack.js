// electron-builder strips `node_modules` out of anything copied via
// `extraResources`, so the Next.js standalone server we ship in
// Contents/Resources/app lands without its dependencies and can't resolve
// `next`. Copy them in here — afterPack runs once the .app is assembled but
// before the dmg/zip targets are built from it.

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

exports.default = async function afterPack(context) {
  // only relevant on macOS
  if (context.electronPlatformName !== "darwin") return;

  const projectDir = context.packager.projectDir || process.cwd();
  const src = path.join(projectDir, ".next", "standalone", "node_modules");
  const appName = context.packager.appInfo.productFilename + ".app";
  const appPath = path.join(context.appOutDir, appName);
  const dest = path.join(appPath, "Contents", "Resources", "app", "node_modules");

  if (!fs.existsSync(src)) {
    throw new Error(`[afterPack] standalone node_modules missing at ${src} — did 'next build' run with output:'standalone'?`);
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, verbatimSymlinks: true });
  const count = fs.readdirSync(dest).length;
  console.log(`[afterPack] copied standalone node_modules (${count} entries) -> ${dest}`);

  // Re-sign the WHOLE bundle ad-hoc, AFTER mutating it. We ship unsigned (no
  // Apple Developer cert), and electron-builder leaves only an invalid linker
  // stub, so on Apple Silicon the app reads as "damaged". A valid ad-hoc
  // signature (CodeResources covering every nested binary) fixes that — the app
  // then runs once the user clears quarantine / "Open Anyway".
  console.log(`[afterPack] ad-hoc signing ${appPath} …`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  console.log(`[afterPack] ad-hoc signature verified`);
};
