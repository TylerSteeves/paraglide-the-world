import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import cesium from 'vite-plugin-cesium'

// Safari resolves localhost to ::1, and it will not offer a bypass when the
// certificate omits the address in the URL. This cert names localhost, ::1,
// 127.0.0.1, and the current LAN address.
const certDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.cert')
const https = {
  key: fs.readFileSync(path.join(certDir, 'key.pem')),
  cert: fs.readFileSync(path.join(certDir, 'cert.pem')),
}

export default defineConfig({
  plugins: [cesium()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
    https,
  },
  preview: {
    host: true,
    port: 5173,
    allowedHosts: true,
    https,
  },
})
