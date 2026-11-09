import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Configuration attendue par Tauri : port fixe, pas d'écran effacé.
export default defineConfig({
  plugins: [react()],
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
  envPrefix: ['VITE_', 'TAURI_'],
  build: { target: 'es2021', sourcemap: false },
})
