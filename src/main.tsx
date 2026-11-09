import React from 'react'
import ReactDOM from 'react-dom/client'
import { MantineProvider, createTheme } from '@mantine/core'
import '@mantine/core/styles.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import './app.css'
import App from './App'

// Même base que Pédalons : Inter, indigo, rayons « md ».
const theme = createTheme({
  primaryColor: 'indigo',
  fontFamily: 'Inter, system-ui, sans-serif',
  defaultRadius: 'md',
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <App />
    </MantineProvider>
  </React.StrictMode>,
)
