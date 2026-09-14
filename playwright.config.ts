import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.WEB_PORT ?? 5173);
// 容器验收时可指向已启动的 Web 服务（例如 http://web:80）；
// 本地运行时由 Playwright 自动启动 vite preview。
const externalBaseURL = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: externalBaseURL ?? `http://localhost:${port}`,
    trace: 'on-first-retry',
  },
  webServer: externalBaseURL
    ? undefined
    : {
        command: `npm run preview -- --port ${port}`,
        url: `http://localhost:${port}`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
