import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.mjs', workers: 1,
  timeout: 45000, reporter: 'list',
  use: {baseURL:'http://127.0.0.1:8766',channel:'msedge',headless:true},
  webServer: {command:'.venv\\Scripts\\python.exe server.py --port 8766 --no-browser',url:'http://127.0.0.1:8766/api/health',reuseExistingServer:true},
});
