// Builds the download ZIP for a GitHub release: the built game (dist/) in a game/ folder, next to
// the launchers and how-to from release/. Output: slipstreet-game.zip in the project root (git-ignored).
// Usage: npm run package   (builds first), then attach the ZIP to a release, see README.
import { cpSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = join(root, 'slipstreet-game.zip');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('No build found in dist/. Run "npm run build" first (or use "npm run package").');
  process.exit(1);
}

const stage = mkdtempSync(join(tmpdir(), 'slipstreet-'));
const pkg = join(stage, 'Slipstreet');
cpSync(join(root, 'release'), pkg, { recursive: true }); // keeps the launchers' execute permission
cpSync(dist, join(pkg, 'game'), { recursive: true });
rmSync(out, { force: true });

const r =
  process.platform === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${pkg}' -DestinationPath '${out}'`], { stdio: 'inherit' })
    : spawnSync('zip', ['-qr', '-X', out, 'Slipstreet'], { cwd: stage, stdio: 'inherit' });
rmSync(stage, { recursive: true, force: true });
if (r.status !== 0) {
  console.error('Could not create the ZIP. On Mac and Linux this needs the "zip" command.');
  process.exit(1);
}
console.log(`Created slipstreet-game.zip (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
