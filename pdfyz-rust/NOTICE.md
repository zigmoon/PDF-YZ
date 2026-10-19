# Third-party notices — PDF-YZ

PDF-YZ's own code is proprietary — all rights reserved (see [LICENSE](LICENSE)).
The application loads the following third-party components, which remain
governed by their own licenses:

| Component | Role in PDF-YZ | License |
|---|---|---|
| [pdf.js](https://github.com/mozilla/pdf.js) | PDF rendering, text and vector extraction | Apache-2.0 |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | PDF assembly and export | MIT |
| [fontkit](https://github.com/foliojs/fontkit) | Font embedding and subsetting via pdf-lib | MIT |
| [Tailwind CSS](https://tailwindcss.com/) | Utility classes (CDN build) | MIT |
| [Astro](https://astro.build/) | Static site build (development dependency only) | MIT |

Nothing else is bundled. The Rust core (`pdfyz-rust/`) has **no** third-party
dependency at all: it builds with `std` alone.

Each project's license text is included with its own distribution. Nothing in
this notice grants any right over PDF-YZ itself.
