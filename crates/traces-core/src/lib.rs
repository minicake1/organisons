//! Cœur d’« Organisons » : lecture des GPX, calculs (distance, dénivelé,
//! relief, vent idéal, points d'intérêt, profil) et index SQLite local.
//!
//! Aucune dépendance à Tauri : ce crate se teste seul (`cargo test -p traces-core`).

pub mod analyze;
pub mod autotags;
pub mod error;
pub mod geo;
pub mod gpxmeta;
pub mod index;
pub mod model;
pub mod naming;
pub mod organize;
pub mod scan;
pub mod sport;
pub mod surface;

pub use analyze::{analyze_file, analyze_gpx};
pub use error::{Error, Result};
pub use index::{Index, OrganizeRow};
pub use model::*;
