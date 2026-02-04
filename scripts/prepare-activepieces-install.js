import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const root = process.cwd();
const activepiecesRoot = path.join(root, 'activepieces');
const activepiecesNodeModules = path.join(activepiecesRoot, 'node_modules');

if (fs.existsSync(activepiecesNodeModules)) {
  fs.rmSync(activepiecesNodeModules, { recursive: true, force: true });
  console.log(`[postinstall] removed ${activepiecesNodeModules}`);
}

const lockfile = path.join(activepiecesRoot, 'package-lock.json');
const useCi = fs.existsSync(lockfile);

const installCmd = useCi
  ? 'npm --prefix activepieces ci --include=dev --no-audit --no-fund'
  : 'npm --prefix activepieces install --include=dev --no-audit --no-fund';

if (!useCi) {
  console.warn('[postinstall] activepieces/package-lock.json missing, using npm install');
}

execSync(installCmd, { stdio: 'inherit' });
