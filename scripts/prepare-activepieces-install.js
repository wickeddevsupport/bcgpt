import fs from 'fs';
import path from 'path';

const activepiecesNodeModules = path.join(
  process.cwd(),
  'activepieces',
  'node_modules'
);

if (fs.existsSync(activepiecesNodeModules)) {
  fs.rmSync(activepiecesNodeModules, { recursive: true, force: true });
  console.log(`[postinstall] removed ${activepiecesNodeModules}`);
}

const lockfile = path.join(process.cwd(), 'activepieces', 'package-lock.json');
if (!fs.existsSync(lockfile)) {
  console.warn('[postinstall] activepieces/package-lock.json missing');
}
