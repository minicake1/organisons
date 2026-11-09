//! Types partagés avec l'interface (sérialisés en JSON, champs en camelCase).

use serde::{Deserialize, Serialize};

/// Relief, mêmes seuils que Pédalons (mètres de D+ par km).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Hilliness {
    /// moins de 8 m/km
    Flat,
    /// de 8 à 15 m/km
    Hilly,
    /// plus de 15 m/km
    Mountainous,
}

impl Hilliness {
    pub fn from_ratio(m_per_km: f64) -> Self {
        if m_per_km < 8.0 {
            Self::Flat
        } else if m_per_km <= 15.0 {
            Self::Hilly
        } else {
            Self::Mountainous
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Flat => "FLAT",
            Self::Hilly => "HILLY",
            Self::Mountainous => "MOUNTAINOUS",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "FLAT" => Some(Self::Flat),
            "HILLY" => Some(Self::Hilly),
            "MOUNTAINOUS" => Some(Self::Mountainous),
            _ => None,
        }
    }
}

/// Les 8 directions de vent (d'où vient le vent).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WindDirection {
    N,
    NE,
    E,
    SE,
    S,
    SW,
    W,
    NW,
}

impl WindDirection {
    pub const ALL: [WindDirection; 8] = [
        Self::N,
        Self::NE,
        Self::E,
        Self::SE,
        Self::S,
        Self::SW,
        Self::W,
        Self::NW,
    ];
    pub fn angle(self) -> f64 {
        match self {
            Self::N => 0.0,
            Self::NE => 45.0,
            Self::E => 90.0,
            Self::SE => 135.0,
            Self::S => 180.0,
            Self::SW => 225.0,
            Self::W => 270.0,
            Self::NW => 315.0,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::N => "N",
            Self::NE => "NE",
            Self::E => "E",
            Self::SE => "SE",
            Self::S => "S",
            Self::SW => "SW",
            Self::W => "W",
            Self::NW => "NW",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|d| d.as_str() == s)
    }
    /// Écart angulaire entre deux directions, en degrés (0 à 180).
    pub fn diff(self, other: Self) -> f64 {
        let d = (self.angle() - other.angle()).abs() % 360.0;
        d.min(360.0 - d)
    }
}

/// Catégorie d'un point d'intérêt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PoiKind {
    /// Point de contrôle (brevets…)
    Control,
    /// Alerte : montée raide, chemin, danger…
    Warning,
    Water,
    Shop,
    /// Curiosité, point de vue, monument…
    Sight,
    Other,
}

impl PoiKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Control => "control",
            Self::Warning => "warning",
            Self::Water => "water",
            Self::Shop => "shop",
            Self::Sight => "sight",
            Self::Other => "other",
        }
    }
    pub fn parse(s: &str) -> Self {
        match s {
            "control" => Self::Control,
            "warning" => Self::Warning,
            "water" => Self::Water,
            "shop" => Self::Shop,
            "sight" => Self::Sight,
            _ => Self::Other,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Poi {
    pub name: String,
    pub kind: PoiKind,
    /// Distance depuis le départ du point de trace le plus proche.
    pub km: f64,
    pub lat: f64,
    pub lon: f64,
    pub symbol: Option<String>,
}

/// Un point du profil, ré-échantillonné à pas constant.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilePoint {
    pub km: f64,
    pub lat: f64,
    pub lon: f64,
    /// Altitude lissée (m).
    pub ele: f64,
    /// Pente locale sur ~200 m (%), pour l'info-bulle.
    pub slope: f64,
    /// Pente la plus forte dans l'intervalle (%), pour colorer le profil
    /// sans lisser les passages raides.
    pub slope_max: f64,
    pub up: f64,
    pub down: f64,
    /// Minutes depuis le départ si le GPX contient des horaires.
    pub minutes: Option<f64>,
}

/// Résultat complet de l'analyse d'un fichier.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceAnalysis {
    pub name: String,
    pub distance_km: f64,
    pub elevation_gain: f64,
    pub elevation_loss: f64,
    pub ele_min: f64,
    pub ele_max: f64,
    pub hilliness: Hilliness,
    pub wind: WindDirection,
    pub start_lat: f64,
    pub start_lon: f64,
    /// [lat min, lon min, lat max, lon max]
    pub bbox: [f64; 4],
    pub point_count: usize,
    pub has_time: bool,
    pub creator: Option<String>,
    pub profile: Vec<ProfilePoint>,
    pub pois: Vec<Poi>,
}

/// Ligne de la bibliothèque (sans le profil).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceSummary {
    pub id: i64,
    pub library_id: i64,
    pub path: String,
    pub name: String,
    pub distance_km: f64,
    pub elevation_gain: f64,
    pub hilliness: Hilliness,
    pub wind: WindDirection,
    pub surface_type: Option<String>,
    pub source: String,
    pub tags: Vec<String>,
    pub poi_count: i64,
    pub added_at: i64,
    /// Aperçu de la trace (≈ 60 points [lat, lon]) pour les vignettes.
    pub preview: Vec<[f64; 2]>,
}

/// Fiche complète.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceDetail {
    #[serde(flatten)]
    pub summary: TraceSummary,
    pub elevation_loss: f64,
    pub ele_min: f64,
    pub ele_max: f64,
    pub notes: String,
    pub has_time: bool,
    pub creator: Option<String>,
    pub profile: Vec<ProfilePoint>,
    pub pois: Vec<Poi>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub id: i64,
    pub name: String,
    pub path: String,
    /// "index" (indexée sur place) ou "managed" (rangée automatiquement)
    pub mode: String,
    pub pattern: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SortKey {
    #[default]
    Date,
    Distance,
    Elevation,
    Hilliness,
    Name,
}

/// Filtres de la bibliothèque (repris de Pédalons + source, tags, vent ±45°).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TraceFilter {
    pub query: Option<String>,
    pub distance_min: Option<f64>,
    pub distance_max: Option<f64>,
    pub elevation_min: Option<f64>,
    pub elevation_max: Option<f64>,
    pub hilliness: Option<Hilliness>,
    pub surface_type: Option<String>,
    pub wind: Option<WindDirection>,
    /// Inclure les directions voisines (±45°).
    pub wind_near: bool,
    pub source: Option<String>,
    pub tag: Option<String>,
    pub sort: SortKey,
    pub ascending: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub added: usize,
    pub updated: usize,
    pub unchanged: usize,
    pub removed: usize,
    pub errors: Vec<String>,
}

/// Groupe de fichiers identiques (même empreinte).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub hash: String,
    pub paths: Vec<String>,
}
