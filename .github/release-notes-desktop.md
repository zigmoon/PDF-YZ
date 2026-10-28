**PDF-YZ @VERSION@** — the PDF editor, as a desktop application.

Everything the web version does, with no browser tab: text and image editing,
annotations, digital signature, print imposition, crop marks, export. The file
you open never leaves your machine, and the application works **fully offline** —
pdf.js, pdf-lib, fontkit, Tailwind and the interface fonts are embedded in the
binary.

## What changed in 0.6.1

- **Correcting one sentence no longer blanks the page.** A page background panel
  that merely *contained* the edited line was re-drawn above the page raster, which
  hid every other text block of the page. Only objects the erase mask actually
  covers (≥ 80 %, and never a page-sized background) are redrawn now.
- **A correction is really saved.** Validating an inline edit used to leave the
  document "clean": no undo step, no auto-save. It now enters the history and the
  session store — Ctrl+Z restores it, and a reload keeps it.
- **"Replace all" with an empty replacement** asks for confirmation, removes the
  blocks it empties instead of leaving invisible clickable ghosts, and says so.
- **Editing works in Modify mode**: double-click edits in place (the panel hint
  follows the mode). Zoom, resize and rebuild commit the edit in progress instead
  of dropping it.
- **Background tab**: page rendering is parked while the tab is hidden and resumed
  on return, instead of staying half-rendered. *Preferences → Render in background*
  keeps it going while you are away.

## Downloads

| System | File |
| --- | --- |
| Windows 10/11 (x64) | `PDF-YZ-Windows-x64-setup.exe` · `PDF-YZ-Windows-x64.msi` |
| macOS 10.15+ (Apple Silicon) | `PDF-YZ-macOS-AppleSilicon.dmg` |
| macOS 10.15+ (Intel) | `PDF-YZ-macOS-Intel.dmg` |
| Linux (x86_64) | `PDF-YZ-Linux-x86_64.AppImage` · `.deb` · `.rpm` |

The `.msi` is for managed deployment (GPO, SCCM); the `.rpm` is for Fedora,
RHEL and openSUSE, where the AppImage offers no desktop integration. Each
installer is built from the same commit, on the system it targets.

## Notes

- The Windows builds are not code-signed: SmartScreen may ask you to confirm the
  publisher. Choose *More info → Run anyway*.
- The macOS builds are not notarised either. On first launch, right-click the
  application and choose *Open*.
- Uninstalling removes the application; your documents are never touched.

## Links

- Web version — https://app.zigmoon.com/PDF-YZ/
- Source — https://github.com/zigmoon/PDF-YZ
- Contact — contact@zigmoon.com

Files are also archived under their version tag, with a `SHA256SUMS` file.
