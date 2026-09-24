import { execFileSync } from 'node:child_process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

function latestCommit(format: string) {
  try {
    return execFileSync('git', ['log', '-1', `--format=${format}`], { encoding: 'utf8' }).trim()
  } catch {
    return '不明'
  }
}

export default defineConfig(({ mode }) => {
  const measurementId = process.env.VITE_GA_MEASUREMENT_ID ?? loadEnv(mode, process.cwd(), '').VITE_GA_MEASUREMENT_ID
  const googleAnalytics = measurementId ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>
    <script>window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments)} gtag('js', new Date()); gtag('config', '${measurementId}');</script>` : ''

  return {
    base: '/screw-counter-builder/',
    plugins: [react(), {
      name: 'google-analytics',
      transformIndexHtml(html) {
        return html.replace('<!-- google-analytics -->', googleAnalytics)
      },
    }],
    define: {
      __BUILD_COMMIT_HASH__: JSON.stringify(latestCommit('%H')),
      __BUILD_COMMIT_DATE__: JSON.stringify(latestCommit('%cI')),
    },
  }
})
