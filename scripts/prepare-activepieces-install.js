import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const root = process.cwd();
const activepiecesRoot = path.join(root, 'activepieces');
const activepiecesNodeModules = path.join(activepiecesRoot, 'node_modules');
const forceClean = process.env.ACTIVEPIECES_CLEAN_INSTALL === 'true';

if (forceClean && fs.existsSync(activepiecesNodeModules)) {
  fs.rmSync(activepiecesNodeModules, { recursive: true, force: true });
  console.log(`[postinstall] removed ${activepiecesNodeModules}`);
}

const verdaccioNodeFetch = path.join(
  activepiecesNodeModules,
  'verdaccio-audit',
  'node_modules',
  'node-fetch'
);
if (fs.existsSync(verdaccioNodeFetch)) {
  fs.rmSync(verdaccioNodeFetch, { recursive: true, force: true });
  console.log(`[postinstall] removed ${verdaccioNodeFetch}`);
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
