//! # pdfyz-impose — imposition
//!
//! Deux familles d'imposition, et une seule source de verite pour chacune :
//!
//! * **Livret (signature)** — deux pages par face, pliees et agraffees. L'ordre
//!   est celui de SuperPrint (`calculateImposition` de
//!   `superprint/app/JS/main.js`), repris tel quel : on part des extremites et on
//!   converge vers le centre.
//!
//!   ```text
//!   4 pages  -> [4|1] [2|3]
//!   8 pages  -> [8|1] [2|7] [6|3] [4|5]
//!   6 pages  -> [blanc|1] [2|blanc] [6|3] [4|5]   (7 et 8 sont des pages blanches)
//!   ```
//!
//!   Le nombre de pages est complete au **multiple de 4** ; les pages blanches
//!   n'existent que sur les planches, le document source n'est jamais modifie.
//!
//! * **N-up** — la suite des pages posee sur une grille, dans l'ordre de lecture
//!   ou dans un autre ordre explicitement demande.
//!
//! Ce crate ne dessine rien : il calcule des positions et un ordre. C'est le
//! JavaScript (`applyImposition`) qui parle a pdf-lib.
//!
//! Feuille de route : `pdfyz_rust/docs/PLAN.md`.

#![forbid(unsafe_code)]

pub mod marks;
pub mod sheet;
pub mod signature;
pub mod slots;

pub use marks::{crop_marks, Segment, DEFAULT_MARK_LEN, DEFAULT_MARK_OFFSET};
pub use sheet::{
    auto_sheet, custom_sheet, resolve_orientation, sheet_size, Orientation, SheetSize, A4,
};
pub use signature::{
    build_sides, pad_to_multiple_of_four, sequential_order, signature_order, Binding, Side,
};
pub use slots::{nup_slots, Slot, SlotOrder};
