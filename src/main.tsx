import React from 'react'
import ReactDOM from 'react-dom/client'
import { MantineProvider, createTheme } from '@mantine/core'
import '@mantine/core/styles.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import './app.css'
import App from './App'

// Même base que Pédalons : Inter, indigo, rayons « md ».
// Thème sombre aux couleurs du thème « Dark » de Vivaldi (version de l'utilisateur) :
// fond #2e2f37, fenêtre #1D1E21, texte #d3d9e3, accent #4b4c53, mise en avant #6590fd.
const theme = createTheme({
  primaryColor: 'indigo',
  primaryShade: { light: 6, dark: 5 },
  fontFamily: 'Inter, system-ui, sans-serif',
  defaultRadius: 'md',
  colors: {
    // dark[0] texte … dark[2] texte atténué, dark[4] bordures, dark[5] survol,
    // dark[6] champs, dark[7] fond des panneaux, dark[8] fond de la fenêtre.
    dark: ['#d3d9e3', '#b9c0cc', '#9aa1ad', '#7c828d', '#4b4c53', '#3e3f47', '#35363e', '#2e2f37', '#1d1e21', '#16171a'],
    // Bleu de mise en avant de Vivaldi (#6590fd) au centre de la gamme, pour le thème sombre.
    indigo: ['#edf2ff', '#dbe4ff', '#bac8ff', '#91a7ff', '#7d9bfe', '#6590fd', '#4c6ef5', '#4263eb', '#3b5bdb', '#364fc7'],
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <App />
    </MantineProvider>
  </React.StrictMode>,
)
