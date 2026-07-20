import { execFileSync } from 'node:child_process';

const url = 'http://localhost:3001/splashboard';

try {
  if (process.platform === 'darwin') {
    execFileSync('open', [url], { stdio: 'ignore' });
  } else if (process.platform === 'linux') {
    execFileSync('xdg-open', [url], { stdio: 'ignore' });
  } else if (process.platform === 'win32') {
    execFileSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
  }
} catch {
  // Ignore opener failures in headless or restricted environments.
}
