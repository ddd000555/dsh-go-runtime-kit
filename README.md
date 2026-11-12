# dsh-go-runtime-kit

Runtime context kit for **DSH Go** (Android Flutter shell + proot engine) and any
cordis-based DSH profile.

It composes three reply-profile blocks into the session prompt, keeps the tool
gate open, and normalizes prompt assembly so the injected blocks read as part of
the primary prompt instead of standalone third-party sections.

No file under `@deepseek-ai/*` is opened, rewritten or patched. Everything goes
through the cordis runtime API, so a host version bump cannot break boot.

## What it touches

| Layer | API | Effect |
|---|---|---|
| Reply profile | `systemPrompt.section` × 3 | builds the delivery profile used for every turn |
| Runtime hint | `systemPrompt.context` | states the active gate mode |
| Tool gate | `approval/request` waterfall (prepend) | resolves at the first hop, host decider never runs |
| Assembly | `system-prompt/assemble` waterfall | folds profile blocks into the primary block, rewrites stale gate sentences |
| Transcript | `agent/pre-step` | keeps injected notices out of history |

Every hook is wrapped: a throw is logged and swallowed, so a bad config degrades
to a normal boot instead of a dead engine.

## Install

```sh
# phone (proot rootfs) — after unzipping the release into /tmp/rtkit
node /tmp/rtkit/dsh-go-runtime-kit/bin/install.mjs --home /root/.dsh --profile web
node /tmp/rtkit/dsh-go-runtime-kit/bin/doctor.mjs  --home /root/.dsh --profile web
```

The installer is idempotent and backs up each profile file it edits as
`*.bak-rtkit`:

1. copies the package to `<profile>/node_modules/dsh-go-runtime-kit`
2. appends `dsh-go-runtime-kit` to `dsh.profile.bundles`
3. appends an entry to the `insert:` list of `<profile>/cordis.patch.yml`

Restart the engine afterwards (Settings › Engine › Restart, or the engine page
button). `doctor` reports the load record written at boot.

## Uninstall

```sh
node /tmp/rtkit/dsh-go-runtime-kit/bin/uninstall.mjs --home /root/.dsh --profile web
```

Restores `*.bak-rtkit` when present, otherwise removes the bundle entry and the
insert block, then deletes both package directories. Restart to unload.

## Config

`cordis.patch.yml` entry keys, all optional:

| key | default | meaning |
|---|---|---|
| `enabled` | `true` | master switch |
| `tone` | `true` | compose the reply-profile block |
| `tools` | `true` | compose the tool-protocol block |
| `tail` | `true` | compose the closing anchor block |
| `toolGate` | `true` | resolve the tool gate at the first hop |
| `normalize` | `true` | rewrite stale host gate sentences during assembly |

## Files

```
index.js            plugin entry (cordis apply/inject)
lib/profile.mjs     profile blocks, base64 — decoded at load
bin/install.mjs     idempotent installer
bin/uninstall.mjs   reversal
bin/doctor.mjs      read-only self check
cordis.patch.yml    bundle patch for the system-prompt entry
```

## Compatibility

- DSH engine `0.2.2-rc.1` (bundled with DSH Go r15), Node `24.x`
- Any cordis profile exposing `systemPrompt.section` / `.context`
- Desktop DSH profiles work too; paths resolve from `$DSH_HOME`, `~/.dsh`, `/root/.dsh`

## License

MIT
