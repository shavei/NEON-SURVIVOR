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

The Android app is the **exact same game as the website** — it's a
[Trusted Web Activity](https://developer.chrome.com/docs/android/trusted-web-activity) that runs
`https://neon-survivor.com` natively, so the **Supabase global leaderboard, sign-in, and
achievements all work identically** with nothing extra to configure. Update the website and the
app updates with it.

> Installing: open the downloaded `.apk` on your phone and allow installs from your browser when
> prompted (it's signed but not distributed through the Play Store, so Android treats it as a
> sideload). Minimum Android 5.0 (API 21).

## How the APK is built

The APK is produced in CI from the live site — no Android code lives in the game itself:

- [`twa-manifest.json`](twa-manifest.json) — [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)
  config (host, name, colors, icons) pointing at `neon-survivor.com`.
- [`manifest.webmanifest`](manifest.webmanifest) + [`icons/`](icons/) — the PWA manifest and app
  icons that Bubblewrap reads from the deployed site.
- [`.github/workflows/android-apk.yml`](.github/workflows/android-apk.yml) — builds and signs the
  APK and publishes it.

**To cut a release:**

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow builds the APK and attaches it to the matching GitHub Release as
`neon-survivor.apk`, which keeps the `releases/latest/download/neon-survivor.apk` link above
permanently valid. You can also trigger it manually from the **Actions** tab (that path uploads the
APK as a build artifact instead of publishing a release).

### Optional: fullscreen (drop the address bar)

By default a TWA shows a thin browser address bar unless the site verifies the app via
[Digital Asset Links](https://developers.google.com/digital-asset-links). To go fullscreen:

1. Generate a signing keystore once and add it to the repo as secrets
   (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`). Without these
   the workflow still builds an installable APK using a throwaway key.
2. Copy the `SHA256:` fingerprint the build logs print into
   [`.well-known/assetlinks.json`](.well-known/assetlinks.json) (replacing the placeholder) and
   redeploy the site.

The game runs fully either way — the asset-links step only removes the address bar.

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
