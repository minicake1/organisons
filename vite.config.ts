import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Numéro de version affiché dans l’appli (pied de page, crédits), lu dans package.json.
const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

// Configuration attendue par Tauri : port fixe, pas d'écran effacé.
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    // Le workspace Cargo est à la racine : sans cela, Vite surveille target/
    // et plante sous Windows (EBUSY sur les .exe/DLL en cours d'écriture).
    // Une fonction plutôt que des globs : les globs ne reconnaissent pas
    // les chemins Windows avec antislash.
    watch: {
      ignored: (chemin: string) =>
        /[\\/](target|src-tauri|crates|node_modules|\.git)([\\/]|$)/.test(chemin),
    },
  },
  // MapLibre 6 charge son worker par une URL : le pré-regroupement de Vite le casse.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  envPrefix: ['VITE_', 'TAURI_'],
  // ES2022 : cible de MapLibre 6 (WebView2 le gère).
  build: { target: 'es2022', sourcemap: false },
})
