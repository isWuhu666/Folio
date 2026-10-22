import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'android/app/src/main/assets/www');
// This directory is generated solely from trusted repository web sources.
const expectedRelative = path.join('android', 'app', 'src', 'main', 'assets', 'www');
if (path.relative(root, target) !== expectedRelative || path.isAbsolute(path.relative(root, target))) {
  throw new Error('Android generated asset target must stay inside this repository');
}
await stat(path.join(root, 'web/vendor/pdfjs/build/pdf.mjs'));
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const entry of await readdir(path.join(root, 'web'))) {
  await cp(path.join(root, 'web', entry), path.join(target, entry), { recursive: true });
}
await cp(path.join(root, 'examples'), path.join(target, 'examples'), { recursive: true });
console.log(`Android offline assets prepared: ${target}`);
