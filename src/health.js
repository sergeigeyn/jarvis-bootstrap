// HTTP /health endpoint — для Dashboard
import { createServer } from 'http';
import { execSync } from 'child_process';
import { getProfile } from './onboarding.js';
import { loadState, getTodayCost } from './state.js';
import { config } from './config.js';

const PORT = 3000;
const START_TIME = Date.now();

function getGitVersion() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: process.cwd(), timeout: 2000 })
      .toString().trim();
  } catch {
    return 'unknown';
  }
}

export function startHealthServer() {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/health') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const profile = getProfile();
    const state = loadState();
    const uptimeSeconds = Math.floor((Date.now() - START_TIME) / 1000);

    const data = {
      status: 'active',
      version: getGitVersion(),
      uptime: uptimeSeconds,
      agent_name: profile.agentName || config.agentName || 'Джарвис',
      owner_name: profile.ownerName || null,
      engine: config.engine || 'claude',
      daily_cost: getTodayCost(),
      permission_mode: state.permissionMode || 'auto',
      onboarded: profile.onboarded || false,
    };

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(data));
  });

  server.listen(PORT, () => {
    console.log(`[health] HTTP server on port ${PORT}`);
  });

  server.on('error', (err) => {
    console.error(`[health] ${err.message}`);
  });

  return server;
}
