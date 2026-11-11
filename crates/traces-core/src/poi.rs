//! Reconnaissance des points d'intérêt d'après le tableau d'équivalences
//! `data/poi-equivalences.md` (lisible sur GitHub, enrichi au fil des plateformes).
//! Le tableau est intégré à la compilation et vérifié par les tests.

use std::collections::HashMap;
use std::sync::OnceLock;

use crate::model::PoiKind;

const TABLE: &str = include_str!("../data/poi-equivalences.md");

/// Types de POI acceptés par le Karoo (API Hammerhead).
pub const KAROO_TYPES: [&str; 9] = ["Food", "Water", "Parking", "Camping", "Lodging", "Geocache", "Summit", "Generic", "Danger"];

#[derive(Debug, Clone, Copy, PartialEq)]
enum Target {
    /// Catégorie fixée par le symbole.
    Kind(PoiKind),
    /// D'après le nom, sinon cette catégorie.
    NameThen(PoiKind),
}

#[derive(Debug, Clone)]
struct SymbolRule {
    target: Target,
    karoo: Option<String>,
}

#[derive(Debug, Clone)]
enum Keyword {
    /// Mots entiers consécutifs ; le dernier peut n'être qu'un début de mot (`*`).
    Words { words: Vec<String>, prefix: bool },
    /// Texte sans lettre ni chiffre (`%`), cherché tel quel.
    Raw(String),
}

/// Tableau d'équivalences lu.
#[derive(Debug, Clone)]
pub struct PoiRules {
    karoo_by_kind: HashMap<PoiKind, String>,
    symbols: HashMap<String, SymbolRule>,
    words: Vec<(Vec<Keyword>, PoiKind)>,
}

/// Minuscules, sans accents, apostrophes unifiées.
fn normalize(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| match c {
            'à' | 'â' | 'ä' | 'á' | 'ã' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' | 'í' | 'ì' => 'i',
            'ô' | 'ö' | 'ó' | 'ò' | 'õ' => 'o',
            'ù' | 'û' | 'ü' | 'ú' => 'u',
            'ç' => 'c',
            'ÿ' => 'y',
            '’' | '`' => '\'',
            c => c,
        })
        .collect()
}

fn words_of(s: &str) -> Vec<String> {
    s.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_string).collect()
}

fn kind_of(code: &str) -> Option<PoiKind> {
    let k = PoiKind::parse(code.trim());
    (k.as_str() == code.trim()).then_some(k)
}

/// Cellules d'une ligne de tableau Markdown (`| a | b |`).
fn cells(line: &str) -> Vec<String> {
    let inner = line.trim().trim_start_matches('|').trim_end_matches('|');
    inner.split('|').map(|c| c.trim().to_string()).collect()
}

fn values(cell: &str) -> impl Iterator<Item = &str> {
    cell.split(';').map(str::trim).filter(|v| !v.is_empty())
}

impl PoiRules {
    /// Lit le tableau ; toute erreur (catégorie ou type Karoo inconnu, ligne mal formée) est signalée.
    pub fn parse(text: &str) -> Result<Self, String> {
        let mut rules = PoiRules { karoo_by_kind: HashMap::new(), symbols: HashMap::new(), words: Vec::new() };
        let mut section = String::new();
        for (n, line) in text.lines().enumerate() {
            let at = |m: String| format!("poi-equivalences.md, ligne {} : {m}", n + 1);
            if let Some(title) = line.strip_prefix("## ") {
                section = title.trim().to_string();
                continue;
            }
            if !line.trim_start().starts_with('|') || line.contains("|---") {
                continue;
            }
            let c = cells(line);
            let header = matches!(c.first().map(String::as_str), Some("Code" | "Symbole" | "Mots"));
            if header {
                continue;
            }
            let karoo = |v: &str| -> Result<Option<String>, String> {
                match v.trim() {
                    "" => Ok(None),
                    t if KAROO_TYPES.contains(&t) => Ok(Some(t.to_string())),
                    t => Err(at(format!("type Karoo inconnu « {t} »"))),
                }
            };
            match section.as_str() {
                "Catégories" => {
                    let [code, _, k] = c.as_slice() else { return Err(at("3 colonnes attendues".into())) };
                    let kind = kind_of(code).ok_or_else(|| at(format!("catégorie inconnue « {code} »")))?;
                    let k = karoo(k)?.ok_or_else(|| at("type Karoo manquant".into()))?;
                    rules.karoo_by_kind.insert(kind, k);
                }
                "Symboles" => {
                    let [syms, _, cat, k] = c.as_slice() else { return Err(at("4 colonnes attendues".into())) };
                    let target = match cat.strip_prefix("nom, sinon ") {
                        Some(code) => Target::NameThen(kind_of(code).ok_or_else(|| at(format!("catégorie inconnue « {code} »")))?),
                        None => Target::Kind(kind_of(cat).ok_or_else(|| at(format!("catégorie inconnue « {cat} »")))?),
                    };
                    let karoo = karoo(k)?;
                    for s in values(syms) {
                        let key = normalize(s);
                        if rules.symbols.insert(key, SymbolRule { target, karoo: karoo.clone() }).is_some() {
                            return Err(at(format!("symbole « {s} » déjà présent")));
                        }
                    }
                }
                "Mots du nom" => {
                    let [words, cat] = c.as_slice() else { return Err(at("2 colonnes attendues".into())) };
                    let kind = kind_of(cat).ok_or_else(|| at(format!("catégorie inconnue « {cat} »")))?;
                    let list = values(words)
                        .map(|w| {
                            let w = normalize(w);
                            let (w, prefix) = match w.strip_suffix('*') {
                                Some(p) => (p.to_string(), true),
                                None => (w, false),
                            };
                            let ws = words_of(&w);
                            if ws.is_empty() { Keyword::Raw(w) } else { Keyword::Words { words: ws, prefix } }
                        })
                        .collect();
                    rules.words.push((list, kind));
                }
                _ => {}
            }
        }
        for k in [
            PoiKind::Control,
            PoiKind::Warning,
            PoiKind::Water,
            PoiKind::Shop,
            PoiKind::Sight,
            PoiKind::Lodging,
            PoiKind::Service,
            PoiKind::Other,
        ] {
            if !rules.karoo_by_kind.contains_key(&k) {
                return Err(format!("poi-equivalences.md : catégorie « {} » absente du tableau Catégories", k.as_str()));
            }
        }
        Ok(rules)
    }

    fn symbol(&self, sym: Option<&str>, type_: Option<&str>) -> Option<&SymbolRule> {
        [sym, type_].into_iter().flatten().find_map(|s| self.symbols.get(&normalize(s.trim())))
    }

    fn by_name(&self, name: &str) -> Option<PoiKind> {
        let norm = normalize(name);
        let tokens = words_of(&norm);
        let hit = |k: &Keyword| match k {
            Keyword::Raw(r) => norm.contains(r.as_str()),
            Keyword::Words { words, prefix } => tokens.windows(words.len()).any(|win| {
                win.iter().zip(words).enumerate().all(|(i, (t, w))| {
                    if *prefix && i == words.len() - 1 { t.starts_with(w.as_str()) } else { t == w }
                })
            }),
        };
        self.words.iter().find(|(list, _)| list.iter().any(hit)).map(|(_, kind)| *kind)
    }

    /// Catégorie d'un POI d'après son symbole (`<sym>`, sinon `<type>`) et son nom.
    pub fn classify(&self, sym: Option<&str>, type_: Option<&str>, name: &str) -> PoiKind {
        match self.symbol(sym, type_).map(|r| r.target) {
            Some(Target::Kind(k)) => k,
            Some(Target::NameThen(k)) => self.by_name(name).unwrap_or(k),
            None => self.by_name(name).unwrap_or(PoiKind::Other),
        }
    }

    /// Type Karoo : celui du symbole s'il en a un précis, sinon celui de la catégorie.
    pub fn karoo_type(&self, sym: Option<&str>, type_: Option<&str>, kind: PoiKind) -> &str {
        let from_symbol = self.symbol(sym, type_).filter(|r| matches!(r.target, Target::Kind(k) if k == kind)).and_then(|r| r.karoo.as_deref());
        from_symbol.or_else(|| self.karoo_by_kind.get(&kind).map(String::as_str)).unwrap_or("Generic")
    }
}

/// Tableau intégré à l'appli (vérifié par les tests).
pub fn rules() -> &'static PoiRules {
    static RULES: OnceLock<PoiRules> = OnceLock::new();
    RULES.get_or_init(|| PoiRules::parse(TABLE).expect("tableau d'équivalences des POI invalide"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tableau_valide() {
        PoiRules::parse(TABLE).unwrap();
    }

    #[test]
    fn erreurs_signalees() {
        let base = "## Catégories\n| Code | Nom | Karoo |\n|---|---|---|\n| control | C | Generic |\n";
        assert!(PoiRules::parse(base).unwrap_err().contains("absente"));
        let bad = TABLE.replace("| 104 | Openrunner | water | |", "| 104 | Openrunner | eau | |");
        assert!(PoiRules::parse(&bad).unwrap_err().contains("catégorie inconnue « eau »"));
        let bad = TABLE.replace("| Summit |", "| Sommet |");
        assert!(PoiRules::parse(&bad).unwrap_err().contains("type Karoo inconnu"));
    }

    #[test]
    fn plateformes() {
        let r = rules();
        // Openrunner
        assert_eq!(r.classify(Some("1"), None, "CP 4 - Pointe du Roc"), PoiKind::Control);
        assert_eq!(r.classify(Some("104"), None, "Eau cimetière"), PoiKind::Water);
        assert_eq!(r.classify(Some("60"), None, "Batterie"), PoiKind::Sight);
        // Komoot : highlights « Flag, Blue » classés par leur nom, sinon curiosité.
        assert_eq!(r.classify(Some("Flag, Blue"), None, "Point de vue"), PoiKind::Sight);
        assert_eq!(r.classify(Some("Flag, Blue"), None, "Chapelle Saint-Blaise"), PoiKind::Sight);
        assert_eq!(r.classify(Some("Flag, Blue"), None, "Côte du Saz"), PoiKind::Warning);
        assert_eq!(r.classify(Some("Flag, Blue"), None, "Petite descente avec bosses"), PoiKind::Warning);
        assert_eq!(r.classify(Some("Flag, Blue"), None, "Camping Belle Rivière"), PoiKind::Lodging);
        assert_eq!(r.classify(Some("Flag, Blue"), None, "L'Erdurière"), PoiKind::Sight);
        assert_eq!(r.classify(Some("flag, blue"), None, "Fontaine du bourg"), PoiKind::Water);
        // Garmin et gpx.studio
        assert_eq!(r.classify(Some("Bridge"), None, "Petit Pont en Pierre"), PoiKind::Sight);
        assert_eq!(r.classify(Some("Campground"), None, "Camping"), PoiKind::Lodging);
        assert_eq!(r.classify(Some("Parking Area"), None, "P"), PoiKind::Service);
        assert_eq!(r.classify(Some("Drinking Water"), None, "x"), PoiKind::Water);
        // <type> quand <sym> manque ; sinon le nom.
        assert_eq!(r.classify(None, Some("Restaurant"), "x"), PoiKind::Shop);
        assert_eq!(r.classify(Some("Flag"), None, "CP 2 Vallet"), PoiKind::Control);
        assert_eq!(r.classify(None, None, "Fontaine du bourg"), PoiKind::Water);
        assert_eq!(r.classify(None, None, "Vue"), PoiKind::Other);
        assert_eq!(r.classify(None, None, "Pente à 12 %"), PoiKind::Warning);
        // Mots entiers : « bois » ne trouve pas « boisson », « eau » ne trouve pas « beaucoup ».
        assert_eq!(r.classify(None, None, "Boisson fraîche"), PoiKind::Other);
        assert_eq!(r.classify(None, None, "Beaucoup de monde"), PoiKind::Other);
    }

    #[test]
    fn types_karoo() {
        let r = rules();
        assert_eq!(r.karoo_type(Some("Campground"), None, PoiKind::Lodging), "Camping");
        assert_eq!(r.karoo_type(Some("Hotel"), None, PoiKind::Lodging), "Lodging");
        assert_eq!(r.karoo_type(Some("Parking Area"), None, PoiKind::Service), "Parking");
        assert_eq!(r.karoo_type(Some("Summit"), None, PoiKind::Sight), "Summit");
        assert_eq!(r.karoo_type(Some("60"), None, PoiKind::Sight), "Generic");
        assert_eq!(r.karoo_type(Some("1"), None, PoiKind::Control), "Generic");
        assert_eq!(r.karoo_type(None, None, PoiKind::Warning), "Danger");
    }
}
