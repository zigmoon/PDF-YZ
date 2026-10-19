//! # pdfyz-model — le modele du document
//!
//! Ce qui n'est ni de la geometrie pure ni de l'imposition, mais qui decide de ce
//! que l'application considere comme « une page », « une session » ou « le meme
//! objet » :
//!
//! * [`range`] — analyse de la saisie `1-4, 7, 10-12` du panneau d'imposition ;
//! * [`session`] — identifiant stable d'un document dans le stockage local ;
//! * [`graphic`] — empreinte d'un objet vectoriel, qui supprime les doublons
//!   qu'un PDF peint deux fois ;
//! * [`zorder`] — l'echelle de plans du calque d'edition, en un seul endroit.
//!
//! Feuille de route : `pdfyz_rust/docs/PLAN.md`.

#![forbid(unsafe_code)]

pub mod graphic;
pub mod range;
pub mod session;
pub mod zorder;

pub use graphic::{graphic_signature, js_round};
pub use range::parse_page_range;
pub use session::session_id;
pub use zorder::{z_index, Layer};
