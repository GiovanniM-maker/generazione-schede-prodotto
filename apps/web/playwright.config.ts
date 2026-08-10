import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Test E2E con un browser VERO.
//
// I test unitari non vedono l'interfaccia: overflow orizzontale, aree di tocco
// troppo piccole, elementi che si coprono a vicenda restano invisibili finche'
// qualcuno non apre la pagina. Questi test aprono la pagina.
//
// `executablePath` punta al Chromium gia' presente nell'ambiente: senza, il
// pacchetto ne cerca una build diversa dalla sua e fallisce con "Executable
// doesn't exist" — che sembra un blocco insormontabile e invece e' un flag.
// Si puo' sovrascrivere con CHROMIUM_PATH.
const chromiumPath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
// `--no-sandbox`: nei container si gira come root e senza questo il browser
// si chiude subito ("Running as root without --no-sandbox is not supported").
const launch = existsSync(chromiumPath)
  ? { launchOptions: { executablePath: chromiumPath, args: ['--no-sandbox'] } }
  : {};

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...launch } },
    {
      // Telefono definito a mano: i profili "iPhone" di Playwright sono WebKit,
      // e qui c'e' solo Chromium. Quello che conta e' la MISURA dello schermo
      // e il tocco, non il motore.
      name: 'mobile',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        ...launch,
      },
    },
  ],
  webServer: {
    command: 'pnpm --filter web dev',
    url: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
