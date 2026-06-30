# NEON SURVIVOR

A neon HTML5 canvas **auto-shooter**. WASD to move — your gun fires itself. Kill enemies →
earn XP → level up → pick **one of three upgrades**. Stack weapons, evolve them through merges,
survive three difficulties, and take down rotating boss archetypes. Vanilla JS, no dependencies,
runs offline.

## ▶ Play

**Web:** <https://neon-survivor.com>

## 📱 Android (APK)

[![Download APK](https://img.shields.io/badge/Download-Android%20APK-54e6b5?style=for-the-badge&logo=android&logoColor=white)](https://github.com/shavei/neon-survivor/releases/latest/download/neon-survivor.apk)

**[⬇ Download the latest APK](https://github.com/shavei/neon-survivor/releases/latest/download/neon-survivor.apk)** ·
[all releases](https://github.com/shavei/neon-survivor/releases)

The Android app is a **standalone native app** built with
[Capacitor](https://capacitorjs.com). It runs the game in the app's own Android System WebView —
**not** the Chrome app — so there's **no address bar, no "Running in Chrome", and screen-time
counts as NEON SURVIVOR**. The WebView loads `https://neon-survivor.com`, so it's the **exact same
game** and the **Supabase leaderboard, sign-in, and achievements all work identically** with
nothing extra to configure. Update the website and the app updates with it.

> Installing: open the downloaded `.apk` on your phone and allow installs from your browser when
> prompted (it's signed but not distributed through the Play Store, so Android treats it as a
> sideload). Minimum Android 5.1 (API 22).

## How the APK is built

The APK is produced in CI — no native code is committed to the repo:

- [`capacitor.config.json`](capacitor.config.json) — Capacitor config (app id, name, and
  `server.url` pointing the WebView at `neon-survivor.com`).
- [`tools/gen-android-icons.cjs`](tools/gen-android-icons.cjs) — generates the branded launcher
  icons; [`www/`](www/) is the offline fallback page.
- [`.github/workflows/android-apk.yml`](.github/workflows/android-apk.yml) — generates the native
  Android project with Capacitor, then builds, signs, and publishes the APK.

**To cut a release:**

```bash
git tag v1.0.1
git push origin v1.0.1
```

The workflow builds the APK and attaches it to the matching GitHub Release as
`neon-survivor.apk`, which keeps the `releases/latest/download/neon-survivor.apk` link above
permanently valid. You can also trigger it manually from the **Actions** tab (that path uploads the
APK as a build artifact instead of publishing a release).

### Optional: a stable signing key

By default the workflow generates a throwaway signing key each run, so the APK always builds and
sideloads. To make app updates install over each other (same signature every release), generate a
keystore once and add it as repo secrets — `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_PASSWORD` — and the build will use it.

## Development

Static site, no build step. Serve the repo root and open `index.html`:

```bash
npx serve .       # or any static file server
```

Leave [`js/config.js`](js/config.js) Supabase keys empty to run fully offline with an on-device
leaderboard; fill them in for the global scoreboard (the anon key is a public client token — Row
Level Security is the real boundary).

### Verify

```bash
node .claude/skills/neon-survivor/verify.cjs        # syntax + headless load + boss sim
node .claude/skills/neon-survivor/verify-size.cjs   # 28 KB per-file guard for served js/*.js
```

See [`CLAUDE.md`](CLAUDE.md) for the full architecture and the rest of the `verify*.cjs` suite.

## Deploy

Hosted on Vercel (`vercel` for a preview, `vercel --prod` to ship).
