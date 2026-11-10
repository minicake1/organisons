// Construit les installateurs d'une version publique, sans l'application Hammerhead
// intégrée, puis vérifie qu'aucun secret de `src-tauri/hammerhead.local.env` ne
// se trouve dans l’exécutable que les installateurs emballent.
//
//   npm run build:public
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Chemin décodé (espaces, accents) : « C:\Users\Jean Dupont\… ».
const root = fileURLToPath(new URL('..', import.meta.url))
const envFile = join(root, 'src-tauri', 'hammerhead.local.env')

// Valeurs à ne jamais retrouver dans ce qui sera diffusé.
const secrets = existsSync(envFile)
  ? readFileSync(envFile, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && /^HAMMERHEAD_CLIENT_(ID|SECRET)=/.test(l))
      .map((l) => l.split('=').slice(1).join('=').trim())
      .filter((v) => v.length >= 6)
  : []

const build = spawnSync('npx', ['tauri', 'build'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, ORGANISONS_PUBLIC_BUILD: '1' },
})
if (build.status !== 0) process.exit(build.status ?? 1)

// Les installateurs (.msi, .exe) sont compressés : on ne peut rien y chercher.
// Ils emballent l'exécutable construit juste avant, c'est donc lui qu'on vérifie.
const exe = join(root, 'target', 'release', 'organisons.exe')
if (!existsSync(exe)) {
  console.error(`ERREUR : ${exe} introuvable, vérification impossible. Ne pas diffuser.`)
  process.exit(2)
}
const bytes = readFileSync(exe)
const leaked = secrets.some((s) => bytes.includes(Buffer.from(s, 'utf8')) || bytes.includes(Buffer.from(s, 'utf16le')))
if (leaked) {
  console.error(`ERREUR : un identifiant Hammerhead se trouve dans ${exe}. Ne pas diffuser les installateurs.`)
  process.exit(2)
}
console.log(
  secrets.length
    ? `Vérifié : aucun identifiant Hammerhead dans organisons.exe, que les installateurs emballent. Ils peuvent être diffusés (target/release/bundle).`
    : 'Pas de fichier hammerhead.local.env : rien à vérifier, la version est publique par construction.',
)
