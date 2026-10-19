<!--
  Texte de la page de version « pdfyz-desktop-latest ».
  `@VERSION@` est remplacé par la version de `pdfyz-desktop/src-tauri/tauri.conf.json`
  au moment de la publication. C'est la SEULE source de ce texte : le workflow
  relit ce fichier à chaque passage plutôt que d'écrire les notes dans le YAML,
  parce que deux copies divergeraient à la première modification.
-->

**PDF-YZ @VERSION@** — the PDF editor, as a desktop application.

Everything the web version does, with no browser tab: text and image editing,
annotations, digital signature, print imposition, crop marks, export. The file
you open never leaves your machine, and the application works **fully offline** —
pdf.js, pdf-lib, fontkit, Tailwind and the interface fonts are embedded in the
binary.

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
