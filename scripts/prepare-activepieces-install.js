import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const root = process.cwd();
const activepiecesRoot = path.join(root, 'activepieces');
const activepiecesNodeModules = path.join(activepiecesRoot, 'node_modules');
const skipInstall =
  process.env.SKIP_ACTIVEPIECES_INSTALL === 'true' ||
  process.env.SKIP_ACTIVEPIECES_INSTALL === '1';
const isRender =
  String(process.env.RENDER || '').toLowerCase() === 'true' ||
  Boolean(process.env.RENDER_SERVICE_ID) ||
  Boolean(process.env.RENDER_EXTERNAL_URL);
const forceClean = process.env.ACTIVEPIECES_CLEAN_INSTALL === 'true' || isRender;

const usePnpm = process.env.ACTIVEPIECES_USE_PNPM !== 'false';
const pnpmVersion = process.env.ACTIVEPIECES_PNPM_VERSION || '9.15.0';

const tryExec = (command) => {
  try {
    execSync(command, { stdio: 'inherit' });
    return true;
  } catch (err) {
    return false;
  }
};

if (skipInstall) {
  console.log('[postinstall] SKIP_ACTIVEPIECES_INSTALL=true, skipping activepieces install');
  process.exit(0);
}

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

let pnpmReady = false;
if (usePnpm) {
  pnpmReady = tryExec('pnpm -v');
  if (!pnpmReady) {
    const corepackOk = tryExec('corepack enable') && tryExec(`corepack prepare pnpm@${pnpmVersion} --activate`);
    pnpmReady = corepackOk && tryExec('pnpm -v');
  }
}

if (pnpmReady) {
  console.log('[postinstall] using pnpm for activepieces install');
  execSync('pnpm -C activepieces install --no-frozen-lockfile --prod=false', { stdio: 'inherit' });
} else {
  const lockfile = path.join(activepiecesRoot, 'package-lock.json');
  const useCi = fs.existsSync(lockfile);
  const installCmd = useCi
    ? 'npm --prefix activepieces ci --include=dev --no-audit --no-fund'
    : 'npm --prefix activepieces install --include=dev --no-audit --no-fund';

  if (!useCi) {
    console.warn('[postinstall] activepieces/package-lock.json missing, using npm install');
  }

  execSync(installCmd, { stdio: 'inherit' });
}
