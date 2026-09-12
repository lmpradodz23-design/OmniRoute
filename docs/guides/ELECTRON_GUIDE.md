---
title: "Electron Desktop Guide"
version: 3.8.40
lastUpdated: 2026-06-28
---

# Electron Desktop Guide

> **Source of truth:** `electron/` workspace
> **Last updated:** 2026-06-28 — v3.8.40

OmniRoute ships a cross-platform desktop app (Windows / macOS / Linux) built on
**Electron 41** + **electron-builder 26.10**. The desktop app spawns the Next.js
standalone server as a child process, points a `BrowserWindow` at it, and adds a
system tray, auto-updater, IPC bridge, and zero-config secret bootstrap.

## Architecture

```
┌──────────────────────────────────────────────┐
│ Electron main process (electron/main.js)     │
│ ├─ Single-instance lock                       │
│ ├─ Child process: Next.js standalone server  │
│ │   (spawned with Electron's Node runtime)   │
│ ├─ BrowserWindow → http://localhost:PORT     │
│ ├─ System tray + context menu                │
│ ├─ Auto-update via electron-updater          │
│ ├─ Content Security Policy (session headers) │
│ └─ Secret bootstrap (JWT / API_KEY_SECRET)   │
└──────────────────────────────────────────────┘
            ↕ IPC bridge (electron/preload.js)
┌──────────────────────────────────────────────┐
│ Renderer (Next.js dashboard)                  │
│   window.electronAPI.* (contextIsolation)     │
└──────────────────────────────────────────────┘
```

## Versions

Confirmed from `electron/package.json`:

| Package            | Version                                                   |
| ------------------ | --------------------------------------------------------- |
| `electron`         | `^43.4.1`                                                 |
| `electron-builder` | `^26.15.3`                                                |
| `electron-updater` | `^6.8.9`                                                  |
| `better-sqlite3`   | root `^13.0.2` (Node-API prebuilds — no Electron rebuild) |
| App version        | `3.8.0`                                                   |
| App id             | `online.omniroute.desktop`                                |
| Product name       | `OmniRoute`                                               |

## Scripts (root `package.json`)

| Script                            | Purpose                                                                    |
| --------------------------------- | -------------------------------------------------------------------------- |
| `npm run electron:dev`            | Starts `npm run dev` + waits for `localhost:20128` + launches Electron     |
| `npm run electron:build`          | Builds Next.js then runs `electron-builder` for the current OS             |
| `npm run electron:build:win`      | Builds Windows NSIS installer + portable (x64)                             |
| `npm run electron:build:mac`      | Builds macOS DMG (Intel + Apple Silicon)                                   |
| `npm run electron:build:linux`    | Builds Linux AppImage + DEB (x64 + arm64)                                  |
| `npm run electron:smoke:packaged` | Launches packaged binary and probes `/login` for HTTP 200, then shuts down |

The `electron/` workspace also exposes:

- `npm run prepare:bundle` — runs `scripts/build/prepare-electron-standalone.mjs`
- `npm run build:mac-x64` / `build:mac-arm64` — single-arch macOS builds
- `npm run pack` — directory-only build for local testing (no installer)

## Directory Layout

```
electron/
├── package.json              # Electron deps + electron-builder config
├── main.js                   # Main process (24 KB — see annotations below)
├── preload.js                # contextBridge IPC bridge
├── types.d.ts                # AppInfo / ServerStatus / ElectronAPI types
├── README.md                 # In-workspace notes
├── assets/                   # icon.png, icon.ico, icon.icns, tray-icon.png
└── dist-electron/            # electron-builder output (gitignored)

scripts/
├── build/
│   └── prepare-electron-standalone.mjs   # Stages .next/electron-standalone bundle
└── dev/
    └── smoke-electron-packaged.mjs       # Post-build smoke test
```

Both `main.js` and `preload.js` are **CommonJS `.js` files**, not TypeScript. The
renderer-side typings live in `electron/types.d.ts`.

## IPC Bridge (`preload.js`)

The preload exposes a whitelisted API on `window.electronAPI` using `contextBridge`
with `contextIsolation: true` and `nodeIntegration: false`.

```javascript
const VALID_CHANNELS = {
  invoke: [
    "get-app-info",
    "open-external",
    "get-data-dir",
    "restart-server",
    "check-for-updates",
    "download-update",
    "install-update",
    "get-app-version",
  ],
  send: ["window-minimize", "window-maximize", "window-close"],
  receive: ["server-status", "port-changed", "update-status"],
};
```

Exposed methods:

| Renderer call                                                     | Type                       |
| ----------------------------------------------------------------- | -------------------------- |
| `getAppInfo()` → `{ name, version, platform, isDev, port }`       | invoke                     |
| `openExternal(url)`                                               | invoke                     |
| `getDataDir()`                                                    | invoke                     |
| `restartServer()`                                                 | invoke                     |
| `getAppVersion()`                                                 | invoke                     |
| `checkForUpdates()` / `downloadUpdate()` / `installUpdate()`      | invoke                     |
| `minimizeWindow()` / `maximizeWindow()` / `closeWindow()`         | send                       |
| `onServerStatus(cb)` / `onPortChanged(cb)` / `onUpdateStatus(cb)` | receive (returns disposer) |

The receive helpers return a **disposer function** rather than relying on
`removeAllListeners` — this prevents listener accumulation when React components
remount.

## Server Lifecycle

`main.js` spawns the Next.js standalone bundle directly with the Electron Node
runtime to avoid native-module ABI mismatch with system Node:

```js
spawn(process.execPath, [serverScript], {
  cwd: NEXT_SERVER_PATH,
  env: { ...serverEnv, PORT, NODE_ENV: "production", ELECTRON_RUN_AS_NODE: "1", NODE_PATH },
  stdio: "pipe",
});
```

Highlights:

- `waitForServer()` polls the URL up to 30 s before showing the window (no blank screen on cold start).
- `stdio: "pipe"` captures stdout/stderr; ready phrases (`Ready` / `listening`) emit `server-status: running` over IPC.
- `before-quit` waits up to 5 s for graceful SIGTERM (WAL checkpoint) then sends SIGKILL.
- Port switcher in the tray (`20128`, `3000`, `8080`) stops and restarts the server, then reloads the BrowserWindow.

## Zero-config Secret Bootstrap

On first launch, the main process auto-generates and persists missing secrets:

| Secret                   | Source                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `JWT_SECRET`             | `crypto.randomBytes(64).toString("hex")`                                            |
| `STORAGE_ENCRYPTION_KEY` | `crypto.randomBytes(32).toString("hex")` (refuses if encrypted creds already exist) |
| `API_KEY_SECRET`         | `crypto.randomBytes(32).toString("hex")`                                            |

Persisted to `<DATA_DIR>/server.env`. `DATA_DIR` resolves to:

- Windows: `%APPDATA%\omniroute`
- Linux: `$XDG_CONFIG_HOME/omniroute` or `~/.omniroute`
- macOS: `~/.omniroute`

## Window & Tray

- `BrowserWindow`: 1400×900 (min 1024×700), `backgroundColor: "#0a0a0a"`.
- macOS: `titleBarStyle: "hiddenInset"`, traffic-light at `{ x: 16, y: 16 }`.
- Windows/Linux: native title bar.
- Close button minimizes to tray; the tray menu has **Open OmniRoute**, **Open Dashboard** (external browser), **Server Port** submenu, **Check for Updates**, **Quit**.

## Content Security Policy

Set via `session.defaultSession.webRequest.onHeadersReceived`. Notable directives:

- `frame-ancestors 'none'`, `object-src 'none'`, `child-src 'none'`
- `connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https://*.omniroute.online https://*.omniroute.dev`
- Dev mode adds `'unsafe-eval'` to `script-src` only

## Auto-update

Uses `electron-updater` with the GitHub provider (`LMPrado-DZ23/OmniRoute`).

- `autoDownload = false`, `autoInstallOnAppQuit = true`
- Events forwarded to renderer via `update-status` IPC:
  `checking`, `available`, `not-available`, `downloading` (with `percent`), `downloaded`, `error`
- `installUpdate()` kills the server then calls `autoUpdater.quitAndInstall()`
- Skipped in dev mode (`!app.isPackaged`)

## Build Pipeline

1. `npm run build` → Next.js standalone in `.next/standalone`.
2. `prepare-electron-standalone.mjs` → re-stages into `.next/electron-standalone` and rewrites absolute paths inside `server.js` + `required-server-files.json` so the bundle is relocatable.
3. `electron-builder` packages `main.js`, `preload.js`, `node_modules`, and `extraResources: { ../.next/electron-standalone → app }`.

### Build targets

| OS      | Targets                                   |
| ------- | ----------------------------------------- |
| Windows | NSIS installer + portable (x64)           |
| macOS   | DMG (Intel + arm64, drag-to-Applications) |
| Linux   | AppImage + DEB (x64 + arm64)              |

NSIS settings: `oneClick: false`, lets the user choose the install directory, creates Desktop and Start-Menu shortcuts.

## Smoke Testing Packaged Build

```bash
npm run electron:smoke:packaged
```

`scripts/dev/smoke-electron-packaged.mjs`:

- Auto-discovers the packaged binary in `electron/dist-electron/` for the current platform.
- Launches with isolated `HOME`/`APPDATA`/`XDG_*` directories so it doesn't touch developer data.
- Polls `http://127.0.0.1:20128/login` for HTTP 200 within 45 s.
- Watches stderr/stdout for fatal patterns (`Cannot find module`, `MODULE_NOT_FOUND`, `ERR_DLOPEN_FAILED`, `Failed to start server`, etc.).
- Waits 2 s of stable runtime after readiness, then issues SIGTERM and waits for the port to free.
- In CI, automatically passes `--no-sandbox --disable-gpu` (and `--disable-dev-shm-usage` on Linux).

Env overrides: `ELECTRON_SMOKE_APP_EXECUTABLE`, `ELECTRON_SMOKE_URL`, `ELECTRON_SMOKE_TIMEOUT_MS`, `ELECTRON_SMOKE_SETTLE_MS`, `ELECTRON_SMOKE_DATA_DIR`, `ELECTRON_SMOKE_KEEP_DATA`, `ELECTRON_SMOKE_STREAM_LOGS`.

## Code Signing

> **Status (v3.8.51):** the release pipeline is **ready to sign**, but no certificate has
> been provided yet, so the published installers are still **unsigned**: Windows shows a
> SmartScreen warning, and macOS Gatekeeper blocks the first launch. Signing turns on
> per platform the moment the repository secrets below exist. No code change is needed.

### How the pipeline decides

- The `Build Electron for <platform>` step in `.github/workflows/electron-release.yml`
  receives the secrets **only through `env:`**, each gated on the matrix OS. The Windows leg
  never sees Apple credentials, and the macOS legs never see Windows ones.
- `scripts/build/electron-signing.mjs` runs the build and logs one line per leg with secret
  **names only**, e.g. `signing: enabled (Developer ID Application certificate from MAC_CSC_LINK)`
  or `signing: disabled (missing secret WIN_CSC_LINK, …)`.
- **No secrets** → unsigned build with the same artifacts as before. **A partial set** (e.g.
  `APPLE_API_KEY_ID` without `APPLE_API_ISSUER`) → that leg fails with the list of missing
  secrets. The other legs and the release job still run. A macOS certificate without any
  notarization credentials builds a signed but **not notarized** app, with a warning.
- `electron/package.json` → `build.mac` sets `hardenedRuntime: true` plus two entitlement
  files, applied only to signed builds:
  - `electron/assets/entitlements.mac.plist` covers the main app: V8 JIT and unsigned executable
    memory.
  - `electron/assets/entitlements.mac.inherit.plist` covers the helpers, which also get
    library-validation off. The server runs inside the Electron Helper and loads prebuilt
    native addons.

  Network entitlements are not needed: they apply only to sandboxed (Mac App Store) apps.

### Repository secrets to create

Create them under **Settings → Secrets and variables → Actions → New repository secret**,
or with `gh secret set <NAME> -R LMPrado-DZ23/OmniRoute` (it reads the value from stdin
and never echoes it). Never commit a certificate, key, or password.

**macOS: signing** (both required to sign):

| Secret                 | Contains                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `MAC_CSC_LINK`         | base64 of the **Developer ID Application** certificate + private key exported as `.p12`    |
| `MAC_CSC_KEY_PASSWORD` | the password chosen when exporting that `.p12` (an empty one works but is not recommended) |

**macOS: notarization.** Pick ONE option; if both are complete, the API key wins.

| Option                                     | Secret                        | Contains                                                                |
| ------------------------------------------ | ----------------------------- | ----------------------------------------------------------------------- |
| A: App Store Connect API key (recommended) | `APPLE_API_KEY_P8`            | the downloaded `AuthKey_XXXXXXXXXX.p8` file (PEM text, or base64 of it) |
| A                                          | `APPLE_API_KEY_ID`            | the 10-character Key ID                                                 |
| A                                          | `APPLE_API_ISSUER`            | the Issuer ID (UUID) shown above the keys list                          |
| B: Apple ID                                | `APPLE_ID`                    | the Apple Account e-mail of a team member                               |
| B                                          | `APPLE_APP_SPECIFIC_PASSWORD` | an app-specific password generated at account.apple.com                 |
| B                                          | `APPLE_TEAM_ID`               | the 10-character Team ID                                                |

**Windows.** Pick ONE option; if the Azure set is complete, it wins.

| Option                      | Secret                           | Contains                                                                  |
| --------------------------- | -------------------------------- | ------------------------------------------------------------------------- |
| A: Authenticode certificate | `WIN_CSC_LINK`                   | base64 of the code-signing certificate + private key exported as `.pfx`   |
| A                           | `WIN_CSC_KEY_PASSWORD`           | the `.pfx` export password                                                |
| B: Azure Trusted Signing    | `AZURE_TENANT_ID`                | Microsoft Entra tenant ID of the app registration                         |
| B                           | `AZURE_CLIENT_ID`                | client (application) ID of that app registration                          |
| B                           | `AZURE_CLIENT_SECRET`            | a client secret of that app registration                                  |
| B                           | `AZURE_TRUSTED_SIGNING_ENDPOINT` | the account's regional endpoint, e.g. `https://eus.codesigning.azure.net` |
| B                           | `AZURE_TRUSTED_SIGNING_ACCOUNT`  | the Trusted Signing account name                                          |
| B                           | `AZURE_TRUSTED_SIGNING_PROFILE`  | the certificate profile name                                              |

For option B, the app registration needs the **Trusted Signing Certificate Profile Signer**
role on the certificate profile. electron-builder installs the `TrustedSigning` PowerShell
module on the runner at build time.

### Exporting the certificates as base64

macOS (Keychain Access → My Certificates → expand "Developer ID Application: …" so the
private key is included → Export → `.p12` with a strong password):

```bash
base64 -i DeveloperID.p12 | tr -d '\n' > DeveloperID.p12.b64
gh secret set MAC_CSC_LINK -R LMPrado-DZ23/OmniRoute < DeveloperID.p12.b64
gh secret set MAC_CSC_KEY_PASSWORD -R LMPrado-DZ23/OmniRoute        # prompts for the value
gh secret set APPLE_API_KEY_P8 -R LMPrado-DZ23/OmniRoute < AuthKey_XXXXXXXXXX.p8
rm DeveloperID.p12.b64
```

Windows (PowerShell, with an exportable `.pfx`):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("codesign.pfx")) | gh secret set WIN_CSC_LINK -R LMPrado-DZ23/OmniRoute
gh secret set WIN_CSC_KEY_PASSWORD -R LMPrado-DZ23/OmniRoute
```

### Prerequisites and cost (general terms; check current vendor pricing)

- **Apple:** an Apple Developer Program membership (about US$99/year, individual or
  organization). The Account Holder creates the **Developer ID Application** certificate
  under Certificates, Identifiers & Profiles. For option A, create a Team API key with
  the Developer role under App Store Connect → Users and Access → Integrations. The `.p8`
  can be downloaded only once.
- **Windows certificate (option A):** an OV or EV code-signing certificate from a public CA,
  typically a few hundred US$ per year after identity validation. Since June 2023, CAs issue
  new code-signing keys only on hardware tokens or cloud HSMs, which cannot be exported as a
  `.pfx`. Option A therefore fits only a certificate you already hold as an exportable file.
  Otherwise use option B.
- **Windows Azure Trusted Signing (option B):** an Azure subscription with a Trusted Signing
  account (a low monthly fee) and a validated identity. Eligibility rules for organizations and
  individuals are set by Microsoft.
- SmartScreen reputation builds up with downloads, so the first signed releases may still
  show a warning for a while. Once a release is signed, keep signing every later release
  with the same publisher.
- Linux AppImage/deb packages are not code-signed by this pipeline.

### Attaching signed installers to an existing release

After the secrets exist, re-run the desktop build for the tag. `publish_npm=false` keeps the
npm leg from running again:

```bash
gh workflow run electron-release.yml --ref release/v3.8.51 -f version=v3.8.51 -f publish_npm=false
```

(Add `-R LMPrado-DZ23/OmniRoute` when running outside a clone.)

**This re-attaches assets built from the code at the version tag, and nothing newer.** Every
build job checks out the tag named by `version`, not the dispatched branch. Commits merged
into `release/v3.8.51` after tag `v3.8.51` are **not** included. The dispatched branch supplies
only the workflow file and the signing helper. A tag created before the helper existed still
signs, using electron-builder's defaults: hardened runtime on, plus its template entitlements.

- **v3.8.51 specifically:** the Windows leg cannot succeed at that tag. Tag `v3.8.51`
  (1054f199d) predates the Windows packaging fix merged at 18ec68ebc, and the dispatched run
  34710550989 failed on that leg. The re-run can attach signed **macOS** installers to
  v3.8.51, but not a Windows one.
- **Signed installers of new code** (including that Windows fix) require cutting a **new
  version tag**, e.g. `v3.8.52`. Pushing that tag runs this workflow with the signing secrets
  already in place.

The release job re-uploads the installers and the `latest*.yml` updater manifests under the
same names. Check the log for the `signing: enabled` lines, then verify the downloaded files:

```bash
codesign --verify --deep --strict --verbose=2 /Applications/OmniRoute.app
spctl --assess --type execute --verbose /Applications/OmniRoute.app   # "source=Notarized Developer ID"
```

```powershell
Get-AuthenticodeSignature .\OmniRoute.Setup.3.8.51.exe | Format-List Status, SignerCertificate
```

## Distribution

Artifacts land in `electron/dist-electron/`:

- `OmniRoute.Setup.X.Y.Z.exe`, `OmniRoute X.Y.Z.exe` (Windows)
- `OmniRoute-X.Y.Z-mac.dmg`, `OmniRoute-X.Y.Z-arm64-mac.dmg` (macOS)
- `OmniRoute-X.Y.Z.AppImage`, `omniroute-desktop_X.Y.Z_amd64.deb` (Linux)

Releases are published to GitHub Releases (`LMPrado-DZ23/OmniRoute`), which is also where `electron-updater` checks for new versions.

## Troubleshooting

| Symptom                                                         | Fix                                                                                                                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cannot find module 'better-sqlite3'` after Electron major bump | better-sqlite3 v13 ships Node-API prebuilds — re-run `npm install` at the root and `prepare:bundle` (it verifies the prebuild for the current platform) |
| `ERR_DLOPEN_FAILED` for native module                           | Re-run `prepare:bundle` — it fails fast when the Node-API prebuild for the current platform is missing                                                  |
| Window appears blank on Linux                                   | Confirm Next.js server actually bound to PORT (check `[Server]` logs)                                                                                   |
| macOS notarization stalls                                       | Ensure `APPLE_*` vars are exported, not just in `.env`                                                                                                  |
| Windows SmartScreen warning                                     | Sign with EV cert, or users right-click → "Run anyway"                                                                                                  |
| Smoke test fails with port-in-use                               | Stop any local dev server on 20128 before running `electron:smoke:packaged`                                                                             |

## See Also

- [SETUP_GUIDE.md](./SETUP_GUIDE.md)
- [RELEASE_CHECKLIST.md](../ops/RELEASE_CHECKLIST.md)
- Source: `electron/main.js`, `electron/preload.js`, `electron/package.json`
- Helpers: `scripts/build/prepare-electron-standalone.mjs`, `scripts/dev/smoke-electron-packaged.mjs`
