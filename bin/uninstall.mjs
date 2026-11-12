#!/usr/bin/env node
/**
 * dsh-go-runtime-kit uninstaller — reverses bin/install.mjs.
 * Removes the bundle entry, the insert entry, the package dir and state dir.
 * Restores *.bak-rtkit backups when they exist.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PKG = "dsh-go-runtime-kit";
const BAK = ".bak-rtkit";

function argsOf(argv) {
  const out = { home: "", profile: "web" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--home") out.home = argv[++i] || "";
    else if (a === "--profile") out.profile = argv[++i] || "web";
  }
  return out;
}

function findHome(explicit) {
  if (explicit) return explicit;
  const env = process.env.DSH_HOME;
  if (env && fs.existsSync(env)) return env;
  for (const c of [path.join(os.homedir(), ".dsh"), "/root/.dsh"]) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return path.join(os.homedir(), ".dsh");
}

function unbuild(file, dry) {
  let raw = "";
  try { raw = fs.readFileSync(file, "utf8"); } catch { return { ok: true, skipped: true }; }
  let json;
  try { json = JSON.parse(raw.replace(/^\uFEFF/, "")); } catch { return { ok: false, error: "bad json" }; }
  const bundles = json?.dsh?.profile?.bundles;
  if (Array.isArray(bundles)) json.dsh.profile.bundles = bundles.filter((b) => b !== PKG);
  if (json.dependencies && json.dependencies[PKG]) delete json.dependencies[PKG];
  const next = JSON.stringify(json, null, 2) + "\n";
  if (next !== raw && !dry) fs.writeFileSync(file, next);
  return { ok: true };
}

function uninsert(file, dry) {
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { return { ok: true, skipped: true }; }
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].indexOf("id: " + PKG) >= 0) {
      // drop this entry and its indented config block
      const ind = (lines[i].match(/^[ ]*/) || [""])[0].length;
      i++;
      while (i < lines.length) {
        const ln = lines[i];
        if (ln.trim() === "") { i++; continue; }
        if ((ln.match(/^[ ]*/) || [""])[0].length <= ind) { i--; break; }
        i++;
      }
      continue;
    }
    out.push(lines[i]);
  }
  const next = out.join("\n");
  if (next !== text && !dry) fs.writeFileSync(file, next);
  return { ok: true };
}

function main() {
  const opts = argsOf(process.argv);
  const home = findHome(opts.home);
  const profileDir = path.join(home, "profiles", opts.profile);
  const report = { home, profile: opts.profile, steps: [] };

  const pkgFile = path.join(profileDir, "package.json");
  const patchFile = path.join(profileDir, "cordis.patch.yml");
  const bakPkg = pkgFile + BAK;
  const bakPatch = patchFile + BAK;

  if (fs.existsSync(bakPkg)) {
    fs.copyFileSync(bakPkg, pkgFile);
    fs.rmSync(bakPkg, { force: true });
    report.steps.push({ step: "restore", file: "package.json" });
  } else {
    report.steps.push({ step: "bundles", ...unbuild(pkgFile, false) });
  }

  if (fs.existsSync(bakPatch)) {
    fs.copyFileSync(bakPatch, patchFile);
    fs.rmSync(bakPatch, { force: true });
    report.steps.push({ step: "restore", file: "cordis.patch.yml" });
  } else {
    report.steps.push({ step: "insert", ...uninsert(patchFile, false) });
  }

  fs.rmSync(path.join(profileDir, "node_modules", PKG), { recursive: true, force: true });
  fs.rmSync(path.join(home, PKG), { recursive: true, force: true });
  report.steps.push({ step: "remove", dirs: 2 });

  console.log(JSON.stringify(report, null, 2));
  console.log("\n[rtkit] removed. Restart the engine to unload.");
}

main();
