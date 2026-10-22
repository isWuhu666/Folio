import {defineConfig} from '@playwright/test';
const port=Number(process.env.FOLIO_TEST_PORT||8766),url=`http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.mjs', workers: 1,
  timeout: 45000, reporter: 'list',
  use: {baseURL:url,channel:process.env.FOLIO_BROWSER_CHANNEL||'msedge',headless:true},
  webServer: {command:`.venv\\Scripts\\python.exe server.py --port ${port} --no-browser`,url:url+'/api/health',reuseExistingServer:!process.env.CI},
});
