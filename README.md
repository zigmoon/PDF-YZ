<p align="center">
  <img src="logo-pdf-yz.svg" width="112" height="112" alt="PDF-YZ" />
</p>

<h1 align="center">PDF-YZ</h1>

<p align="center">
  <strong>A PDF editor that runs entirely on your machine.</strong><br />
  Text, images, annotations, imposition, export — nothing is ever uploaded.
</p>

<p align="center">
  <sub>Rust core · WebAssembly · Astro · Tauri desktop</sub>
</p>

---

## Download

Desktop applications are built by GitHub Actions from this repository — four
platforms, one commit, no unsigned-code surprises beyond the usual first-launch
warning.

| System | Installer |
|---|---|
| **Windows 10/11** (x64) | [`setup.exe`](https://github.com/zigmoon/PDF-YZ/releases/latest/download/PDF-YZ-Windows-x64-setup.exe) · [`.msi`](https://github.com/zigmoon/PDF-YZ/releases/latest/download/PDF-YZ-Windows-x64.msi) |
| **macOS** 10.15+ Apple Silicon | [`.dmg`](https://github.com/zigmoon/PDF-YZ/releases/latest/download/PDF-YZ-macOS-AppleSilicon.dmg) |
| **macOS** 10.15+ Intel | [`.dmg`](https://github.com/zigmoon/PDF-YZ/releases/latest/download/PDF-YZ-macOS-Intel.dmg) |
| **Linux** (x86_64) | [`AppImage`](https://github.com/zigmoon/PDF-YZ/releases/latest/download/PDF-YZ-Linux-x86_64.AppImage) · [`.deb`](https://github.com/zigmoon/PDF-YZ/releases/latest/download/PDF-YZ-Linux-x86_64.deb) · [`.rpm`](https://github.com/zigmoon/PDF-YZ/releases/latest/download/PDF-YZ-Linux-x86_64.rpm) |

Those links always serve the newest build. Each version is also archived under its
tag — [`desktop-v0.6.0`](https://github.com/zigmoon/PDF-YZ/releases/tag/desktop-v0.6.0) —
with a `SHA256SUMS` file beside the binaries.

The Windows and macOS bundles are **not signed or notarised**: SmartScreen asks you
to confirm the publisher, and macOS needs a right-click → *Open* on first launch.
The web version needs none of that — see <https://app.zigmoon.com/PDF-YZ/>.

---

## What it does

PDF-YZ edits a PDF where it sits: on the reader's disk. No account, no upload, no
server. The web app and the desktop build both work with the network switched off.

| Feature | Detail |
|---|---|
| **Real text editing** | Extracted text blocks are masked and re-rendered with your font, size and colour — not overlaid. |
| **Object selection** | Rules, shapes and borders are individually selectable and removable, including decomposed logos. |
| **Images** | Import, then move and scale proportionally with handles. |
| **Annotations** | Highlight, freehand draw, sticky notes, eraser, signature. Shift constrains strokes to horizontal or vertical. |
| **Imposition** | Booklet signatures computed the SuperPrint way: `[1-4][2-3]` for 4 pages, `[1-8][2-7][3-6][4-5]` for 8. Pad to a multiple of 4 first. |
| **Export** | PDF/A standard, custom DPI, page size, crop marks and bleed. |
| **Day / night** | Day by default; the choice made on the pre-home applies to the whole editor. |

---

## The three folders

The project is split in three, each with its own build and its own output.

| Folder | Role | Output |
|---|---|---|
| [`pdfyz-rust/`](pdfyz-rust/) | Calculation core — geometry, colour, paths, imposition, z-order, session arithmetic. **No external crates.** Compiled to WebAssembly. | `pdfyz_core.wasm` (~155 KB) |
| [`pdfyz-astro/`](pdfyz-astro/) | The interface: 16 style sheets, 19 components, one page. The editor logic is a JavaScript module carried over from the original single-file app. | `dist/` — a static site |
| [`pdfyz-desktop/`](pdfyz-desktop/) | A Tauri 2 shell that turns that site into a Windows, macOS and Linux application. | `.exe` / `.msi`, `.app` / `.dmg`, `.AppImage` / `.deb` |

`index.html` at the root is the **original single-file version**. It is frozen: it
serves as the behaviour reference and as the input of the automatic splitter
(`pdfyz-astro/tools/split-legacy.mjs`). The site to deploy is `pdfyz-astro/dist/`.

---

## Why a Rust core

The rules that decide what a user sees — where a page lands in an imposed
signature, what colour a mix produces, which object sits in front of which — are
hard to write twice the same way. So they are written **once**, in Rust, and the
WebAssembly module is the only implementation that has authority.

JavaScript keeps a fallback: if the module fails to load, nothing breaks. That
duplication is only defensible because it is **verified**:
`pdfyz-rust/scripts/validate-wasm.mjs` replays the same cases down both paths and
compares the results — **206 checks**. A disagreement fails the build instead of
surfacing in production.

---

## Build and verify

Requirements: **Node 22+** and **Rust stable**. The `wasm32-unknown-unknown` target
builds the shipped module; `wasm32-wasip1` runs the tests. The social image and the
PNG icons need `sharp`, a dev dependency already declared in `package.json`.

```bash
# Core — format, lint, test, build, parity
cd pdfyz-rust
pwsh -File scripts/check.ps1        # Windows, all of the below in one go
# or, step by step, on any system:
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --target wasm32-wasip1
node scripts/build-wasm.mjs

# Interface
cd pdfyz-astro
npm ci
npm run vendor        # fetches pdf.js, pdf-lib, fontkit, Tailwind and the fonts
npm run dev           # http://127.0.0.1:4322/PDF-YZ/
npm run check         # type-checks the .astro files
npm run build         # -> dist/
node tools/verifie-livraison.mjs   # 37 delivery checks before uploading
```

Rust tests run **in the shipped target**, not natively: what reaches the user is
WebAssembly, and a native test would prove nothing about it.

---

## Desktop application

```bash
cd pdfyz-desktop
npm ci
npx tauri dev         # development window
npx tauri build       # installers for the current system
```

`beforeBuildCommand` runs `scripts/prepare-bundle.mjs`, which chains: WebAssembly
core → Astro build with `--base /` → copy into `frontend/`, the folder embedded in
the binary. Three output assertions there fail loudly rather than produce a blank
window: no remote resource, core present, wasm embedded.

### Building without Visual Studio (Windows, MinGW)

An LLVM-MinGW toolchain is enough, provided you use the
`x86_64-pc-windows-gnullvm` Rust distribution:

```bash
rustup toolchain install stable-x86_64-pc-windows-gnullvm
rustup target add wasm32-unknown-unknown --toolchain stable-x86_64-pc-windows-gnullvm
pwsh -File scripts/build-windows-gnullvm.ps1
```

The script links `libunwind` statically and bundles `WebView2Loader.dll` — which the
MSVC toolchain, for its part, links statically. Output lands in `dist-windows/`.

### Installers are produced by GitHub Actions

| Workflow | What it does |
|---|---|
| [`.github/workflows/verifier.yml`](.github/workflows/verifier.yml) | On every push: formatting, clippy, tests, wasm module and parity, then `astro check` and `astro build`. |
| [`.github/workflows/bureau.yml`](.github/workflows/bureau.yml) | On a `v*` tag or manually: builds all four bundles (Windows x64, macOS Intel, macOS ARM, Linux x64) and publishes them in a release. |

Binaries are **neither signed nor notarised**: Windows SmartScreen and Gatekeeper
show a warning on first launch. See
[`.github/release-notes-desktop.md`](.github/release-notes-desktop.md).

---

## The offline rule

The application must **never** depend on the network at runtime. Two consequences,
to be respected when changing the project:

- Every third-party library is **copied locally** by
  `pdfyz-astro/tools/vendor-cdn.mjs` into `public/vendor/` — 5.6 MB, 219 files,
  SHA-256 hashes recorded in `manifest.json`. A second build downloads nothing.
- A service worker would not be enough: it does not register inside a Tauri
  webview, so cache-on-first-visit would leave the desktop app silent offline.

**The single exception, stated plainly:** the text tool's font picker offers Google
families (Roboto, Lato…) that are not bundled. Choosing one downloads that font
**once**, on demand, to embed it in the exported PDF. The editor works without them,
and the failure message names the font instead of failing silently.

Verify by loading the app with the network off, then checking that
`performance.getEntriesByType('resource')` contains no remote URL.

---

## Documentation

- [`agent.md`](agent.md) — working guide: structure, imposition rules, z-order,
  colour, caching, pre-delivery checklist.
- [`pdfyz-rust/docs/PLAN.md`](pdfyz-rust/docs/PLAN.md) — crate breakdown and the C
  interface contract.
- [`pdfyz-rust/README.md`](pdfyz-rust/README.md) — the core, crate by crate.
- [`DEPLOIEMENT.txt`](DEPLOIEMENT.txt) — FTP deployment notes (French).

---

## Licence

Proprietary — see [LICENSE](LICENSE). Third-party components keep their own
licences: see [NOTICE.md](NOTICE.md).
