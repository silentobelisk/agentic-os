// electron-builder strips `node_modules` out of anything copied via
// `extraResources`, so the Next.js standalone server we ship in
// Contents/Resources/app lands without its dependencies and can't resolve
// `next`. Copy them in here — afterPack runs once the .app is assembled but
// before the dmg/zip targets are built from it.

const fs = require("node:fs");
const path = require("node:path");

// Copy the Next.js standalone node_modules into the bundle BEFORE electron-builder
// signs it (afterPack runs before the code-signing step). electron-builder strips
// node_modules out of extraResources, so without this the bundled server can't
// resolve `next`; doing it here means the subsequent Developer ID signing pass
// covers these files (including sharp's native binaries) so notarization passes.
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const projectDir = context.packager.projectDir || process.cwd();
  const src = path.join(projectDir, ".next", "standalone", "node_modules");
  const appName = context.packager.appInfo.productFilename + ".app";
  const dest = path.join(context.appOutDir, appName, "Contents", "Resources", "app", "node_modules");

  if (!fs.existsSync(src)) {
    throw new Error(`[afterPack] standalone node_modules missing at ${src} — did 'next build' run with output:'standalone'?`);
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, verbatimSymlinks: true });
  const count = fs.readdirSync(dest).length;
  console.log(`[afterPack] copied standalone node_modules (${count} entries) -> ${dest}`);
};
