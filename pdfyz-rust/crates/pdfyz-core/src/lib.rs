//! # PDF-YZ — noyau Rust
//!
//! Primitives partagees du refactoring Rust de PDF-YZ : unites typographiques,
//! geometrie d'impression, couleurs (RVB / CMJN / hexadecimals) et trace
//! vectoriel (aplatissement de courbes, boite englobante, chemin SVG).
//!
//! Ce crate est **pur Rust** (aucune dependance) : il compile en natif *ou* en
//! WebAssembly (`wasm32-unknown-unknown`) pour etre appele depuis l'application
//! web. Il ne touche jamais au DOM, ni a un document PDF : chaque fonction
//! prend des nombres et rend des nombres, ce qui la rend testable seule.
//!
//! Feuille de route : `pdfyz_rust/docs/PLAN.md`.

#![forbid(unsafe_code)]

pub mod color;
pub mod geometry;
pub mod path;
pub mod units;

pub use color::{Cmyk, Rgb};
pub use geometry::{fit_centered, fit_scale, Matrix, Point, Rect};
pub use path::{bounds, flatten_cubic, path_data, translate, Subpath};
