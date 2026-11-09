use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("lecture de {path:?} impossible : {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("GPX invalide ({path:?}) : {message}")]
    Gpx { path: PathBuf, message: String },
    #[error("le fichier {0:?} ne contient aucun point de trace")]
    Empty(PathBuf),
    #[error("base de données : {0}")]
    Db(#[from] rusqlite::Error),
    #[error("JSON : {0}")]
    Json(#[from] serde_json::Error),
    #[error("introuvable : {0}")]
    NotFound(String),
}

pub type Result<T> = std::result::Result<T, Error>;
