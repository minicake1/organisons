fn main() {
    // Application Hammerhead d'Organisons (comme Pédalons a la sienne) : client ID
    // et secret lus dans `hammerhead.local.env`, fichier local jamais versionné,
    // et intégrés à l'appli. Sans ce fichier, on les saisit dans les Réglages.
    println!("cargo:rerun-if-changed=hammerhead.local.env");
    // Version publique : `ORGANISONS_PUBLIC_BUILD=1` ignore le fichier, pour ne
    // jamais diffuser le secret (il serait lisible dans l'exécutable).
    println!("cargo:rerun-if-env-changed=ORGANISONS_PUBLIC_BUILD");
    let public = std::env::var("ORGANISONS_PUBLIC_BUILD").is_ok_and(|v| v == "1");
    if public {
        println!("cargo:warning=Version publique : application Hammerhead non intégrée.");
    }
    if let Ok(text) = std::fs::read_to_string("hammerhead.local.env").map_err(|_| ()).and_then(|t| if public { Err(()) } else { Ok(t) }) {
        for line in text.lines() {
            let line = line.trim();
            if line.starts_with('#') {
                continue;
            }
            if let Some((k, v)) = line.split_once('=') {
                let v = v.trim();
                match k.trim() {
                    "HAMMERHEAD_CLIENT_ID" if !v.is_empty() => println!("cargo:rustc-env=ORGANISONS_HAMMERHEAD_CLIENT_ID={v}"),
                    "HAMMERHEAD_CLIENT_SECRET" if !v.is_empty() => println!("cargo:rustc-env=ORGANISONS_HAMMERHEAD_CLIENT_SECRET={v}"),
                    "HAMMERHEAD_REDIRECT_URI" if !v.is_empty() => println!("cargo:rustc-env=ORGANISONS_HAMMERHEAD_REDIRECT_URI={v}"),
                    _ => {}
                }
            }
        }
    }
    tauri_build::build()
}
