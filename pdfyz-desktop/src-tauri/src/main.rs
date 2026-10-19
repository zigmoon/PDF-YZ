// PDF-YZ — lanceur de bureau.
//
// La coquille ne fait qu'une chose : ouvrir l'application PDF-YZ dans la webview
// du système (WebView2 sous Windows, WKWebView sous macOS, WebKitGTK sous Linux).
// Tout l'éditeur reste dans `pdfyz-astro`, embarqué au moment du build par
// `tauri-build` : le binaire ainsi produit fonctionne hors-ligne, y compris
// pour pdf.js et ses cartes CMap, servis depuis `vendor/`.
//
// Aucune commande native n'est exposée : l'application n'a besoin de rien que le
// web ne sache faire. C'est aussi ce qui rend la surface d'attaque nulle — pas
// d'IPC, donc pas de frontière à défendre.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("erreur au lancement de PDF-YZ");
}
