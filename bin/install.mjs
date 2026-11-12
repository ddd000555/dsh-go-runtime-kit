#!/usr/bin/env node
/**
 * dsh-go-runtime-kit installer (phone rootfs / desktop, zero dependencies)
 *
 *  1. copy the package into <profile>/node_modules/<pkg>
 *  2. add <pkg> to <profile>/package.json  -> dsh.profile.bundles
 *  3. append an entry to the "insert:" list of <profile>/cordis.patch.yml (idempotent)
 *  4. back up touched profile files as *.bak-rtkit
 *
 *   node bin/install.mjs
 *   node bin/install.mjs --home /root/.dsh --profile web
 *   node bin/install.mjs --dry-run
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PKG = "dsh-go-runtime-kit";
const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BAK = ".bak-rtkit";

function argsOf(argv) {
  const out = { home: "", profile: "web", dryRun: false, source: HERE };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--home") out.home = argv[++i] || "";
    else if (a === "--profile") out.profile = argv[++i] || "web";
    else if (a === "--source") out.source = argv[++i] || HERE;
    else if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

function findHome(explicit) {
  if (explicit) return explicit;
  const env = process.env.DSH_HOME;
  if (env && fs.existsSync(env)) return env;
  const candidates = [
    path.join(os.homedir(), ".dsh"),
    "/root/.dsh",
    "/data/data/io.github.ccch1mneyyy.dsh_app/files/.dsh",
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return path.join(os.homedir(), ".dsh");
}

function listProfiles(home) {
  const dir = path.join(home, "profiles");
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch { return []; }
}

function backup(file, dry) {
  if (!fs.existsSync(file)) return "";
  const bak = file + BAK;
  if (!fs.existsSync(bak)) {
    if (!dry) fs.copyFileSync(file, bak);
    return bak;
  }
  return bak;
}

function ensureBundle(file, dry) {
  let raw = "";
  try { raw = fs.readFileSync(file, "utf8"); } catch { raw = "{}"; }
  raw = raw.replace(/^\uFEFF/, "");
  let json;
  try { json = JSON.parse(raw); } catch (e) {
    return { ok: false, error: "package.json is not valid JSON: " + e.message };
  }
  json.dsh = json.dsh || {};
  json.dsh.profile = json.dsh.profile || {};
  const bundles = Array.isArray(json.dsh.profile.bundles) ? json.dsh.profile.bundles : [];
  const had = bundles.includes(PKG);
  if (!had) bundles.push(PKG);
  json.dsh.profile.bundles = bundles;
  json.dependencies = json.dependencies || {};
  if (!json.dependencies[PKG]) json.dependencies[PKG] = "file:./node_modules/" + PKG;
  const next = JSON.stringify(json, null, 2) + "\n";
  if (next !== raw) {
    backup(file, dry);
    if (!dry) fs.writeFileSync(file, next);
  }
  return { ok: true, added: !had, bundles };
}

function indentLen(line) {
  const m = line.match(/^[ ]*/);
  return m ? m[0].length : 0;
}

function ensureInsert(file, dry) {
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { text = ""; }
  if (new RegExp("(^|\\n)\\s*-?\\s*id:\\s*" + PKG + "\\b").test(text)) {
    return { ok: true, added: false, reason: "already-present" };
  }
  const entry = [
    "    - id: " + PKG,
    "      name: " + PKG,
    "      config:",
    "        enabled: true",
    "        tone: true",
    "        tools: true",
    "        tail: true",
    "        toolGate: true",
    "        normalize: true",
  ];
  const lines = text.split(/\r?\n/);
  let insertAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*insert:\s*$/.test(lines[i])) {
      const ind = indentLen(lines[i]);
      let j = i + 1;
      let last = i;
      while (j < lines.length) {
        const ln = lines[j];
        if (ln.trim() === "") { j++; continue; }
        if (indentLen(ln) <= ind) break;
        last = j;
        j++;
      }
      insertAt = last + 1;
      break;
    }
  }
  let out;
  if (insertAt >= 0) {
    lines.splice(insertAt, 0, ...entry);
    out = lines.join("\n");
  } else {
    const tail = text.endsWith("\n") || text === "" ? "" : "\n";
    out = text + tail + "\n# " + PKG + "\n- insert:\n" + entry.join("\n") + "\n";
  }
  backup(file, dry);
  if (!dry) fs.writeFileSync(file, out);
  return { ok: true, added: true, mode: insertAt >= 0 ? "merged" : "appended" };
}

function copyPlugin(source, dest, dry) {
  if (dry) return { ok: true, dryRun: true };
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const skip = new Set(["node_modules", ".git", ".github"]);
  const walk = (from, to) => {
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      if (skip.has(e.name) || e.name.indexOf(BAK.replace(".", "")) >= 0) continue;
      const s = path.join(from, e.name);
      const d = path.join(to, e.name);
      if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); walk(s, d); }
      else if (e.isFile()) fs.copyFileSync(s, d);
    }
  };
  walk(source, dest);
  return { ok: true };
}

function main() {
  const opts = argsOf(process.argv);
  const home = findHome(opts.home);
  const profiles = listProfiles(home);
  const targetProfile = opts.profile && profiles.includes(opts.profile) ? opts.profile : (profiles[0] || opts.profile || "web");
  const profileDir = path.join(home, "profiles", targetProfile);
  const report = { home, profile: targetProfile, profiles, dryRun: opts.dryRun, steps: [] };

  if (!fs.existsSync(profileDir)) {
    console.error("[rtkit] profile not found: " + profileDir);
    console.error("[rtkit] available profiles: " + (profiles.join(", ") || "(none)"));
    process.exit(2);
  }

  const nodeModules = path.join(profileDir, "node_modules");
  if (!opts.dryRun) fs.mkdirSync(nodeModules, { recursive: true });
  const dest = path.join(nodeModules, PKG);

  report.steps.push({ step: "copy", ...copyPlugin(opts.source, dest, opts.dryRun) });
  report.steps.push({ step: "bundles", ...ensureBundle(path.join(profileDir, "package.json"), opts.dryRun) });
  report.steps.push({ step: "insert", ...ensureInsert(path.join(profileDir, "cordis.patch.yml"), opts.dryRun) });

  if (!opts.dryRun) {
    try {
      const dir = path.join(home, PKG);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "install.json"), JSON.stringify({
        installedAt: new Date().toISOString(),
        version: JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8")).version,
        home, profile: targetProfile, node: process.version,
      }, null, 2));
    } catch { /* state file is optional */ }
  }

  console.log(JSON.stringify(report, null, 2));
  if (report.steps.some((s) => s.ok === false)) process.exit(1);
  console.log("\n[rtkit] installed. Restart the engine, then: node bin/doctor.mjs --home " + home + " --profile " + targetProfile);
}

main();
