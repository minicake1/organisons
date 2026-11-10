/** Version affichée : « 0.6.0 » devient « v0.6 », « 0.6.1 » reste « v0.6.1 ». */
export const APP_VERSION = `v${__APP_VERSION__.replace(/\.0$/, '')}`
