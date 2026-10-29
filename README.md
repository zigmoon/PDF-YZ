<p align="center">
  <img src="logo-pdf-yz.svg" width="120" alt="PDF-YZ">
</p>

<h1 align="center">PDF-YZ — PDF Editor</h1>

<p align="center">
  <b>A PDF editor that runs entirely on your machine.</b><br>
  Real text editing, individually selectable objects, proportional image handles,<br>
  and print imposition computed by a Rust core — nothing is ever uploaded.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#imposition">Imposition</a> ·
  <a href="#the-rust-core">Rust core</a> ·
  <a href="#desktop-builds">Desktop builds</a> ·
  <a href="#the-offline-rule">Offline</a>
</p>

<p align="center">
  <a href="https://github.com/zigmoon/PDF-YZ/releases/latest"><b>⬇ Download for macOS · Windows · Linux</b></a>
</p>

<p align="center">
  <a href="https://github.com/zigmoon/PDF-YZ/actions/workflows/verifier.yml"><img src="https://github.com/zigmoon/PDF-YZ/actions/workflows/verifier.yml/badge.svg" alt="Verify"></a>
  <a href="https://github.com/zigmoon/PDF-YZ/actions/workflows/bureau.yml"><img src="https://github.com/zigmoon/PDF-YZ/actions/workflows/bureau.yml/badge.svg" alt="Desktop"></a>
</p>

<p align="center">
  <a href="https://app.zigmoon.com/PDF-YZ/">Web version</a> — no install, works offline after the first load
</p>

---

## Why PDF-YZ

Most browser PDF editors are an annotation layer. They let you draw a rectangle
and stamp a signature, and that is genuinely useful — but the document underneath
never changes. Try to remove a hairline rule, correct a typo, or replace a logo
and the tool has nothing to offer.

PDF-YZ treats the page as objects:

- **You can select the things that are actually on the page** — text blocks, rules,
  shapes, image fragments, decomposed logo layers — and remove or restyle them.
- **Text is edited, not covered.** The original glyphs are masked and re-rendered
  with your font, size and colour, so the result re-exports as real text.
- **Imposition is a first-class feature**, not a print dialogue afterthought.
  Booklet signatures and N-up grids are computed the way a print shop computes
  them, and the arithmetic is in Rust rather than in a 400-line JavaScript
  function that nobody dares touch.

And the whole thing stays local. No account, no upload, no server round trip — by
construction, not by policy.

---

## Quick start

```bash
npx serve pdfyz-astro/dist      # any static server works
```

That is the built site. To work on it:

```bash
cd pdfyz-astro
npm ci
npm run dev        # http://127.0.0.1:4322/PDF-YZ/
```

No build step is needed to *read* the code: `index.html` at the repository root is
the original single-file application, still runnable, and it remains the behaviour
reference. The Astro build is generated from it by a mechanical splitter — see
[Architecture](#architecture).

Desktop installers are built by CI on real macOS, Windows and Linux runners. A
`.dmg` cannot be produced from Windows, and a cross-built macOS bundle that was
never code-signed is not something to ship quietly.

---

## Features

### Editing

- **Text** — click an extracted block, edit it inline. Font family (including
  uploadable `.ttf` / `.otf`), size, colour, bold/italic, alignment. The original
  is masked with its own sampled background colour, so the patch disappears.
- **Images** — import, then move and scale with **proportional** handles. A hold
  on `Shift` while dragging a stroke constrains it to horizontal or vertical.
- **Objects** — every editable element carries handles: text, images, strokes,
  notes, signatures. What is selectable is what you can remove.
- **Colour** — selecting an object opens a palette that is also a draggable
  widget: park it where you want, it remembers. Picking the draw, highlight or
  signature tool opens the same palette.
- **Find & replace** across a page or the whole document.
- **Pages** — rotate, duplicate, delete, reorder, crop per page or all pages.

### Annotations

Highlight, freehand draw, sticky notes, eraser, and a canvas signature. Drawing
tools write vector paths, not bitmaps, so they survive export at any DPI.

### Export

| Option | Values |
|---|---|
| Standard | PDF, or **PDF/A** (archival — fonts are force-embedded, because PDF/A forbids the alternative) |
| Resolution | 72 / 150 / 300 / 600 DPI |
| Page size | keep original, A4, Letter, Legal |
| Crop marks | optional, with configurable length and offset |
| ICC | input profile selection with PDF/A output intent |
| SuperPrint | one-click `.sp` conversion, with a choice between editable text and flattened image |

### Sessions

Open documents are kept in IndexedDB for **7 days**, capped at **12 sessions** and
10 MB per file, so closing a tab is not data loss. Nothing in a session leaves the
machine either.

### Background tabs

pdf.js paints page by page through `requestAnimationFrame`, which browsers stop
firing in an inactive tab: a document opened (or still loading) in the background
used to stay half rendered — blank pages, no error — until the tab came back.
Those callbacks are now **parked** and released in a single frame on return, so a
load resumes exactly where it stopped instead of waiting forever; a short notice
appears if the pause lasted more than two seconds. *Preferences → Render in
background* (default OFF) keeps the document preparing itself while the tab is
inactive — slower, because browsers throttle timers of hidden tabs to about one
tick per second.

---

## Imposition

The booklet order is the SuperPrint one: pad the document to a multiple of four
with blank pages, then pair the outside edges inward.

| Pages | Signatures |
|---|---|
| 4 | `[1-4]` `[2-3]` |
| 8 | `[1-8]` `[2-7]` `[3-6]` `[4-5]` |
| 16 | `[1-16]` `[2-15]` … `[8-9]` |

Each pair is one printed side; the sheet count is half the page count. Verified in
the browser with an 8-page sample: four pages of 420 × 297 mm on A3, ordered
`[8|1] [2|7] [6|3] [4|5]`.

Two imposition modes:

| Mode | Use |
|---|---|
| **Booklet (signature)** | saddle-stitch — `[n, 1] [2, n-1]` — or perfect-bound — `[1, 2] [3, 4]`. Always a multiple of 4. |
| **N-up grid** | handouts and proofs in reading order |

N-up supports 2 (spread), 4, 8, 16, 20, 24, 32 and 64 pages per sheet, with sheet
sizes from A5 to A2, SRA3 and SRA4, Letter, Legal, Tabloid, or a custom size.
Spacing, gutter, bleed, margins, crop marks, auto-rotation and print order are all
explicit — a press sheet that silently guessed any of these would be a wasted run.

---

## The Rust core

The rules that decide what a user sees — where a page lands in a signature, what
colour a shade resolves to, which object sits in front of which — are hard to
write twice the same way. So they are written **once**, in Rust, and the
WebAssembly module is the only implementation with authority.

| Crate | Responsibility | Tests |
|---|---|---|
| `pdfyz-core` | units, geometry, colour (hex / CMYK / shade / modal), path bounds and subpaths | 21 |
| `pdfyz-impose` | signatures, sheet geometry, N-up slots, crop marks, auto-rotation | 20 |
| `pdfyz-model` | page ranges, session arithmetic, graphic signatures, z-order | 15 |
| `pdfyz-wasm` | the C ABI — 22 exported functions | 9 |

**65 tests, 3 060 lines, zero external crates.** The `Cargo.lock` contains the four
crates of the workspace and nothing else; that is a constraint, not a coincidence,
because it keeps the build auditable at a glance.

The interface is hand-written C rather than `wasm-bindgen`: every export returns
an `i32`, where `>= 0` is a count and `< -1_000_000` is an error code. Buffers use
a two-pass protocol — call with capacity 0, read the required size, allocate, call
again. A `memory.buffer` is detached on every allocation, so the glue rebuilds its
typed-array views and never keeps one across a call.

### Keeping two implementations honest

JavaScript keeps a fallback: if the module fails to load, the editor still works.
That duplication is only defensible because it is verified.
`pdfyz-rust/scripts/validate-wasm.mjs` re-implements each rule in JavaScript and
compares the results — **206 checks**, run in CI before any release.

It has already earned its place. Three real divergences were caught this way: a
signature that concatenated two flags into one field, a `path_data` count that
counted points instead of `f64`s, and a `-0` that formatted differently on each
side.

The module is **154.6 KB**, and it is built and exercised in the target that ships:
`cargo test --workspace --target wasm32-wasip1`. A native test would prove nothing
about the artefact users actually run.

---

## Day / night

Day is the **default**. Nothing reads `prefers-color-scheme` — the user decides,
and the choice made on the pre-home applies to the whole editor, not just that
screen.

A blocking script at the top of `<head>` sets `<html data-theme>` before the first
paint, so a dark reload never flashes white. `18-theme.css` only redefines tokens,
which is why the toolbar, panels, modals, canvas and mobile chrome all follow
without a rule of their own.

The one thing that needs care: **the accent inverts** from near-black to white. Any
rule written as `color: #fff` on `var(--accent)` becomes `var(--accent-contrast)`,
or the text turns white on white. The dark block lists every such rule explicitly.

`Ctrl/Cmd + T` toggles the theme from anywhere.

---

## Keyboard shortcuts

`Cmd` replaces `Ctrl` on macOS. Press <kbd>F1</kbd> or <kbd>?</kbd> in the app for
the same list.

| Keys | Action |
|---|---|
| `V` `T` `I` `D` `H` `E` | Select / Text / Image / Draw / Highlight / Eraser |
| `M` | Modify mode |
| `Ctrl+O` / `Ctrl+Shift+N` | Open / new blank document |
| `Ctrl+S` / `Ctrl+P` | Export / print |
| `Ctrl+F` | Find & replace |
| `Ctrl+Z` / `Ctrl+Y` `Ctrl+Shift+Z` | Undo / redo |
| `Ctrl+D` | Duplicate selection |
| `Ctrl+B` | Pages sidebar |
| `Ctrl+ + / − / 0 / 1` | Zoom in / out / 100 % / fit |
| `Ctrl+T` | Day / night theme |
| `Page Up` `Page Down` `Home` `End` | Page navigation |
| Arrows / `Shift`+arrows | Nudge 1 px / 10 px |
| `Delete` `Backspace` | Delete selection |
| `Shift` (while drawing) | Constrain the stroke to horizontal or vertical |
| `F1` `?` / `Esc` | Shortcut sheet / close panels |

---

## Architecture

Three folders, three responsibilities, two build pipelines.

```
PDF-YZ/
├── index.html                  original single-file app — frozen, the reference
├── pdfyz-rust/                 calculation core, no external crates
│   ├── crates/pdfyz-core/      units, geometry, colour, paths
│   ├── crates/pdfyz-impose/    signatures, sheets, N-up slots, crop marks
│   ├── crates/pdfyz-model/     ranges, sessions, graphic signatures, z-order
│   ├── crates/pdfyz-wasm/      the C ABI (22 exports)
│   ├── web/pdfyz-core.js       the glue — publishes PdfyzCore
│   └── scripts/                build-wasm, validate-wasm, check
├── pdfyz-astro/                the interface
│   ├── src/styles/             01…16 slices of index.html + 17 prehome + 18 theme
│   ├── src/components/         19 Astro components
│   ├── src/scripts/app.js      the editor module (366 KB, migrated verbatim)
│   ├── src/scripts/theme.js    day / night
│   ├── tools/split-legacy.mjs  the splitter
│   ├── tools/vendor-cdn.mjs    local copy of every third-party file
│   └── tools/verifie-livraison.mjs   37 pre-upload checks
├── pdfyz-desktop/              Tauri 2 shell
└── .github/workflows/          verify + four-platform desktop build
```

### The splitter

`index.html` is 11 450 lines of working application. It is not rewritten by hand:
`tools/split-legacy.mjs` slices it into 16 stylesheets and 19 components, then
copies the module to `src/scripts/app.js` (8 194 lines).

The split is **verifiable**. `--check` fails if a slice has drifted; `CSS_SEGMENTS`
stores **offsets from the `<style>` line**, not absolute line numbers, because
adding a line in `<head>` used to shift the whole file and fail fifteen slices at
once. `BODY_SEGMENTS` anchors on text for the same reason.

`app.js` is generated once and then edited in place — it carries the nine kernel
call sites, which no text rewrite could recreate. `--force-app` is the deliberate
gesture that resets it, and it says so.

Files the splitter must not overwrite are declared in one place:

| List | Contents |
|---|---|
| `HAND_WRITTEN_STYLES` | `17-prehome.css`, `18-theme.css` |
| `HAND_WRITTEN_SCRIPTS` | `../scripts/theme.js` |
| `app.js` | preserved unless `--force-app` |

They override by cascade only — same specificity, later file — so there is no
`!important` anywhere in the project.

### The offline rule

The application must **never** depend on the network at runtime. Two consequences:

- Every third-party file is copied locally by `tools/vendor-cdn.mjs` into
  `public/vendor/` — **219 files, 5.6 MB**, SHA-256 hashes recorded in
  `manifest.json` so a repeat build downloads nothing. Google Fonts returns
  different subset URLs on each call, which is exactly why the reuse path exists.
- A service worker would **not** be enough. It does not register inside a Tauri
  webview, so cache-on-first-visit would leave the desktop app dead offline.

> **One exception, stated plainly.** The text tool's font picker offers Google
> families (Roboto, Lato…) that are not bundled — every weight of every family
> would add several megabytes to a site that is 6.5 MB. Choosing one downloads that
> font **once**, on demand, to embed it in the exported PDF. The editor works
> without them, and when offline the message names the font instead of failing
> silently. `verifie-livraison.mjs` accepts this single URL and fails on any other.

Verify it yourself: load the app with the network off, then check that
`performance.getEntriesByType('resource')` contains no remote URL.

---

## Desktop builds

`pdfyz-desktop/` is a thin **Tauri 2** shell around the same site — no logic is
duplicated. `beforeBuildCommand` runs `scripts/prepare-bundle.mjs`, which chains:
WebAssembly core → Astro build with `--base /` → copy into `frontend/`. Three
assertions refuse to produce a bundle if it contains a remote resource, has lost
the kernel, or is missing the `.wasm`.

```bash
cd pdfyz-desktop
npm ci
npm run dev      # development window
npm run build    # installer for the current OS
```

**Windows without Visual Studio** (LLVM-MinGW). The MSVC toolchain is not always
installable — no admin rights, a test machine, a container. Three adjustments are
needed, and `scripts/build-windows-gnullvm.ps1` makes all three:

```powershell
pwsh -File scripts/build-windows-gnullvm.ps1
```

1. the `x86_64-pc-windows-gnullvm` Rust distribution is required, because an MSVC
   `rustc` refuses to run without `link.exe`;
2. `libunwind` is linked dynamically on that target, which would mean shipping a
   MinGW DLL — the script stages the static archive under the name the linker asks
   for;
3. `WebView2Loader` is only linked statically for `target_env = "msvc"`, so
   `tauri.gnullvm.json` bundles the DLL beside the executable.

The script then **refuses to finish** if the binary still imports a toolchain DLL.
That failure mode is invisible on the build machine — its `PATH` contains the
toolchain — and fatal everywhere else. Verified by launching the portable ZIP from a
clean folder with `PATH` reduced to `C:\Windows`: WebView2 started, kernel reported
`wasm`, zero network requests.

### Download

| Your machine | File | Install |
|---|---|---|
| macOS, Apple Silicon (M1–M4) | [`PDF-YZ-macOS-AppleSilicon.dmg`](https://github.com/zigmoon/PDF-YZ/releases/latest/download/PDF-YZ-macOS-AppleSilicon.dmg) | open the `.dmg`, drag to *Applications* |
| macOS, Intel | [`PDF-YZ-macOS-Intel.dmg`](https://github.com/zigmoon/PDF-YZ/releases/latest/download/PDF-YZ-macOS-Intel.dmg) | same |
| Windows 10/11 | [`setup.exe`](https://github.com/zigmoon/PDF-YZ/releases/latest/download/PDF-YZ-Windows-x64-setup.exe) · [`.msi`](https://github.com/zigmoon/PDF-YZ/releases/latest/download/PDF-YZ-Windows-x64.msi) | run it (the `.msi` is for managed installs) |
| Linux, any distro | [`AppImage`](https://github.com/zigmoon/PDF-YZ/releases/latest/download/PDF-YZ-Linux-x86_64.AppImage) | `chmod +x`, then run — nothing to install |
| Debian / Ubuntu | [`.deb`](https://github.com/zigmoon/PDF-YZ/releases/latest/download/PDF-YZ-Linux-x86_64.deb) | `sudo apt install ./PDF-YZ-*.deb` |
| Fedora / RHEL | [`.rpm`](https://github.com/zigmoon/PDF-YZ/releases/latest/download/PDF-YZ-Linux-x86_64.rpm) | `sudo dnf install ./PDF-YZ-*.rpm` |

Those links follow the newest build. Each version is also archived under its tag —
[`desktop-v0.6.2`](https://github.com/zigmoon/PDF-YZ/releases/tag/desktop-v0.6.2) —
with a `SHA256SUMS` file beside the binaries.

The bundles are **not signed or notarised**: there is no Apple certificate or
Windows signing key in this repository, and claiming otherwise would only move the
failure to the user. Consequences, in full:

- **macOS** — first launch needs right-click → *Open*, or
  `xattr -dr com.apple.quarantine /Applications/PDF-YZ.app`.
- **Windows** — SmartScreen shows "unknown publisher" → *More info* → *Run anyway*.
- **Linux** — the AppImage may need FUSE 2 (`libfuse2`) on newer distributions; the
  `.deb` and `.rpm` have no such requirement.

### Build matrix

| Platform | Artefact |
|---|---|
| macOS Apple Silicon | `.dmg` (`aarch64-apple-darwin`) |
| macOS Intel | `.dmg` (`x86_64-apple-darwin`) |
| Windows | `.msi` + NSIS `.exe` |
| Linux | `.deb`, `.rpm`, `.AppImage` |

Four jobs, **one commit**. The macOS matrix entry is a genuine cross-build: the
`macos-latest` runner is arm64, so `x86_64-apple-darwin` has to be installed as a
Rust target. The Debian package deliberately omits a hand-written `Depends`: setting
that key *replaces* the list Tauri computes, and an empty list installs without
`libwebkit2gtk` — the package then installs cleanly and refuses to start. Verified
after the fact by reading the produced `.deb`: `Depends: libwebkit2gtk-4.1-0,
libgtk-3-0`.

---

## Development notes

Three bugs worth remembering, each found by measurement rather than by reading:

- **The splitter anchored on absolute line numbers.** Eleven lines added to `<head>`
  shifted every slice and failed fifteen of them at once. Offsets from `<style>`
  fixed it permanently.
- **`astro check` was scanning `dist-desktop/`**, including pdf.js at 1.4 MB. It ran
  out of memory and exited 134 with no useful message. Excluded, along with
  `public/vendor`.
- **A white-on-white accent.** Switching to dark inverted `--accent` to white; every
  `color: #fff` sitting on it became invisible. Eight rules were affected, each one
  found by scanning rendered surfaces for `luminance > 0.55` in dark mode.

And one about the icon: it carries **five white pages with black outlines**, no
badge and no background. That is not indecision — it is what makes a single file
legible on a light tab bar, a dark tab bar and the macOS dock at once. Measured at
112 px: 22 % of the square carries ink on white, 63 % on dark.

---

## Delivery checks

`node pdfyz-astro/tools/verifie-livraison.mjs` runs **37 checks** against `dist/`
before anything is uploaded. It looks for what is invisible on screen:

| Check | The failure it prevents |
|---|---|
| Required files present | a forgotten `service-worker.js` or `.wasm` |
| No `agent.md`, no `node_modules` | internal notes published as a second indexable page |
| `<h1>` count is exactly one | the page had none for months — the title was a `<span>` |
| Title 15–65 characters | truncation in search results |
| `og:image` is 1200 × 630 and exists | a square icon declared as `summary_large_image` gets cropped |
| Sitemap URLs exist on disk | the sitemap pointed at a file that had been deleted |
| Manifest icons exist | a PWA icon that 404s on install |
| Service-worker precache entries exist | a silent gap discovered offline |
| No remote *resource* | a CDN call that breaks the offline promise |
| Bundle has no unexpected network call | a dependency hidden in JavaScript rather than HTML |
| `.htaccess` `Options` is inside `<IfModule>` | a directive refused by the host returns 500 on *every* page |
| `no-cache` written after `immutable` | `index.html` frozen in visitors' caches for a year |

That last one is not theoretical: the rules were in the wrong order in the first
draft. `index.html` and `service-worker.js` matched `immutable` and an update would
have taken days to reach anyone.

The checker also had a false positive of its own, which was fixed rather than
tolerated — `Options -Indexes` was flagged as "outside `<IfModule>`" while being
correctly indented inside one. A check that cries wolf teaches people to ignore
checks.

---

## Packaging for a static server

```bash
cd pdfyz-astro
npm run build
node tools/verifie-livraison.mjs     # 37 checks
# then zip dist/ flat: index.html and .htaccess at the archive root
```

The archive is **flat on purpose**: `index.html`, `.htaccess`, `_astro/`, `vendor/`
and `icons/` sit at the root, so you select everything and drop it into `/PDF-YZ/`
on the server. A nested `PDF-YZ/` folder is how you end up with a blank page at
`/PDF-YZ/PDF-YZ/index.html`.

Two things to check when uploading:

- **`.htaccess` is a dotfile.** Most FTP clients hide it, and a file transferred in
  ASCII mode corrupts the `.wasm`. Binary mode is not optional here.
- **Trailing slash.** `/PDF-YZ` must resolve to `/PDF-YZ/`, or relative paths
  resolve against the parent. Apache `mod_dir` and nginx both do this for a real
  directory — do not disable it.

Serve over **HTTPS**: the File System Access API and clipboard need a secure
context, and the PWA install prompt requires one.

---

## Hosting in a subdirectory

PDF-YZ runs unchanged under `https://example.com/PDF-YZ/`. Nothing is hard-coded to
a domain: the vendored assets are resolved from `document.baseURI`, so the same
build works at a domain root (the desktop app) and under a sub-path (the website).
The service worker derives its own scope from its own URL, and the core loads its
`.wasm` beside itself.

`localStorage` and IndexedDB are scoped to the **origin**, not the path, so another
application on the same domain shares them. Every key PDF-YZ writes is prefixed
(`pdfz-prefs`, `pdfz-theme`, `pdfz-sessions`, `pdfz-icc-*`), which makes
coexistence safe as long as the neighbour does not use the same prefix.

---

## Roadmap

- [x] Rust core: geometry, colour, imposition, z-order, sessions
- [x] WebAssembly module with a hand-written C ABI (22 exports)
- [x] 206 parity checks between the module and the JavaScript fallback
- [x] Astro interface, mechanically split from the original single file
- [x] Fully offline: 219 vendored files, no CDN at runtime
- [x] Day / night theme, day by default
- [x] Booklet signatures and N-up imposition
- [x] Native desktop shell — macOS Intel and ARM, Windows, Linux
- [ ] Code signing (Windows OV certificate, Apple notarisation)
- [ ] Multi-page PDF export of imposed sheets in one pass
- [ ] Visual regression tests on import and export
- [ ] Localisation of the interface (English only today)

---

## Licence

Proprietary — © Zigmoon. All rights reserved. See [LICENSE](LICENSE).

Third-party components keep their own licences, listed in [NOTICE.md](NOTICE.md) —
pdf.js (Apache-2.0), pdf-lib (MIT), fontkit (MIT), Tailwind CSS (MIT), and the
bundled Inter, Space Mono and IBM Plex Mono typefaces (SIL OFL 1.1).
