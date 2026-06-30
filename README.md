# ⚡ NEON SURVIVOR

> A neon HTML5 canvas **auto-shooter**. Move, dodge, and let your guns do the talking — survive the swarm, evolve your arsenal, and topple the bosses.

<p>
  <a href="https://neon-survivor.com"><img alt="Play" src="https://img.shields.io/badge/▶_Play-neon--survivor.com-54e6b5?style=for-the-badge"></a>
  <a href="https://github.com/shavei/NEON-SURVIVOR/releases/latest/download/neon-survivor.apk"><img alt="Download APK" src="https://img.shields.io/badge/Download-Android%20APK-54e6b5?style=for-the-badge&logo=android&logoColor=white"></a>
  <img alt="Vanilla JS" src="https://img.shields.io/badge/Vanilla_JS-no_deps-f7df1e?style=for-the-badge&logo=javascript&logoColor=black">
  <img alt="Offline" src="https://img.shields.io/badge/Runs-offline-9b6dff?style=for-the-badge">
</p>

**WASD to move — your gun fires itself.** Kill enemies → earn XP → level up → pick **one of three upgrades**. Stack weapons, merge them into evolved forms, push through three difficulties, and take down rotating boss archetypes. Vanilla JavaScript, zero dependencies, runs offline.

## ▶ Play now

**Web:** **<https://neon-survivor.com>** — no install, just open and play.

## 🎮 Controls

| Action | Key |
| :--- | :--- |
| Move | **W A S D** (or arrow keys) |
| Shoot | **Automatic** — your weapons fire on their own |
| Pick upgrade | Click / number keys on the level-up screen |
| Pause | **Esc** |

## ✨ Features

- 🔫 **Auto-firing arsenal** — collect and stack weapons, then **merge them into evolved forms** through synergies.
- ⬆️ **Roguelite upgrades** — every level-up offers one of three picks; no two runs build the same.
- 👾 **Three boss archetypes** that cycle as you climb the tiers — the crimson brawler **REVENANT**, the cyan bullet-storm **MAELSTROM**, and the swarm-summoning **OVERSEER**.
- 🎚️ **Three difficulties** for a fresh challenge curve each time.
- 🏆 **Global leaderboard, sign-in & achievements** powered by Supabase — or play fully offline with an on-device board.
- 🎨 **Unlockable cosmetics** — skins, trails, color palettes, and themes earned through achievements.
- 🎵 **Adaptive soundtrack** — a built-in synth composer plus unlockable genre beds (jazz / pop / rock / rap), so the game is never silent, even offline.
- 📱 **Installable** as a PWA on the web or as a **standalone Android app**.

## 📱 Android (APK)

[![Download APK](https://img.shields.io/badge/Download-Android%20APK-54e6b5?style=for-the-badge&logo=android&logoColor=white)](https://github.com/shavei/NEON-SURVIVOR/releases/latest/download/neon-survivor.apk)

**[⬇ Download the latest APK](https://github.com/shavei/NEON-SURVIVOR/releases/latest/download/neon-survivor.apk)** ·
[all releases](https://github.com/shavei/NEON-SURVIVOR/releases)

The Android app is a **standalone native app** built with
[Capacitor](https://capacitorjs.com). It runs the game in the app's own Android System WebView —
**not** the Chrome app — so there's **no address bar, no "Running in Chrome", and screen-time
counts as NEON SURVIVOR**. The WebView loads `https://neon-survivor.com`, so it's the **exact same
game** and the **Supabase leaderboard, sign-in, and achievements all work identically** with
nothing extra to configure. Update the website and the app updates with it.

> **Installing:** open the downloaded `.apk` on your phone and allow installs from your browser when
> prompted (it's signed but not distributed through the Play Store, so Android treats it as a
> sideload). Minimum Android 5.1 (API 22).

## 🛠 How the APK is built

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

<details>
<summary><strong>Optional: a stable signing key</strong></summary>

By default the workflow generates a throwaway signing key each run, so the APK always builds and
sideloads. To make app updates install over each other (same signature every release), generate a
keystore once and add it as repo secrets — `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_PASSWORD` — and the build will use it.
</details>

## 💻 Development

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

## 🚀 Deploy

Hosted on Vercel (`vercel` for a preview, `vercel --prod` to ship).

## 🧱 Built with

Vanilla JavaScript · HTML5 Canvas · [Supabase](https://supabase.com) (leaderboard, auth, achievements) · [Capacitor](https://capacitorjs.com) (Android) · [Vercel](https://vercel.com) (hosting + serverless validation). No frameworks, no bundler, no runtime dependencies.

## 📄 License

Proprietary — the source is public to read, but **not** open source. See [`LICENSE`](LICENSE) for the full terms. The "NEON SURVIVOR" name, artwork, and audio are reserved.
