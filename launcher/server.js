import express from 'express';
import { spawn, execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const app = express();
app.use(express.json());
app.use(express.static(resolve(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Runtime detection: docker / podman / compose
// ---------------------------------------------------------------------------
let RUNTIME = null;
let HAS_COMPOSE = false;

function detectRuntime() {
  if (RUNTIME) return;
  try { execSync('docker compose version', { stdio: 'ignore' }); RUNTIME = 'docker'; HAS_COMPOSE = true; return; } catch {}
  try { execSync('docker --version', { stdio: 'ignore' }); RUNTIME = 'docker'; return; } catch {}
  try { execSync('podman compose version', { stdio: 'ignore' }); RUNTIME = 'podman'; HAS_COMPOSE = true; return; } catch {}
  try { execSync('podman --version', { stdio: 'ignore' }); RUNTIME = 'podman'; return; } catch {}
  RUNTIME = null;
}

detectRuntime();

// ---------------------------------------------------------------------------
// Async-safe process runner
// ---------------------------------------------------------------------------
function run(cmd, args, opts) {
  opts = opts || {};
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(cmd, args, { stdio: 'pipe', ...opts });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolvePromise(out.trim());
      else reject(new Error(`Exit ${code}\n${err.trim().slice(0, 300)}`));
    });
    proc.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Compose helpers
// ---------------------------------------------------------------------------
function composeCmd() {
  if (!RUNTIME) throw new Error('No container runtime found');
  return RUNTIME + (HAS_COMPOSE ? ' compose' : '');
}

async function composeUp(service) {
  if (HAS_COMPOSE) {
    await run(RUNTIME, ['compose', 'up', '-d', service], { cwd: ROOT });
  } else if (RUNTIME === 'docker') {
    // fallback: docker run with pre-configured args per service
    await runFallback(service, 'start');
  } else if (RUNTIME === 'podman') {
    await runFallback(service, 'start');
  }
}

async function composeStop(service) {
  if (HAS_COMPOSE) {
    await run(RUNTIME, ['compose', 'stop', service], { cwd: ROOT });
  } else {
    await runFallback(service, 'stop');
  }
}

const FALLBACK_IMAGES = {
  postgres: { image: 'docker.io/timescale/timescaledb:latest-pg16', ports: ['5432:5432'], env: ['POSTGRES_DB=observability', 'POSTGRES_USER=obs', 'POSTGRES_PASSWORD=obspass'] },
  kafka: { image: 'docker.io/confluentinc/cp-kafka:7.6.0', ports: ['9092:9092'], env: ['CLUSTER_ID=RtstpqNjQi2LxEXSjKcbyg', 'KAFKA_NODE_ID=1', 'KAFKA_PROCESS_ROLES=broker,controller', 'KAFKA_CONTROLLER_QUORUM_VOTERS=1@localhost:9093', 'KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER', 'KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT', 'KAFKA_LISTENERS=PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093', 'KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://localhost:9092', 'KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT', 'KAFKA_AUTO_CREATE_TOPICS_ENABLE=true', 'KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1', 'KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1'] },
  opensearch: { image: 'docker.io/opensearchproject/opensearch:2.13.0', ports: ['9200:9200'], env: ['discovery.type=single-node', 'OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m', 'DISABLE_SECURITY_PLUGIN=true'] },
  minio: { image: 'docker.io/minio/minio:latest', ports: ['9000:9000', '9001:9001'], cmd: ['server', '/data', '--console-address', ':9001'] },
  redis: { image: 'docker.io/redis:7-alpine', ports: ['6379:6379'] },
};

async function runFallback(service, action) {
  const cfg = FALLBACK_IMAGES[service];
  if (!cfg) throw new Error('No fallback config for ' + service);
  const name = 'obs-' + service + '-1';

  if (action === 'stop') {
    try { await run(RUNTIME, ['stop', name]); } catch {}
    try { await run(RUNTIME, ['rm', '-f', name]); } catch {}
    return;
  }

  // auto-clean
  try { await run(RUNTIME, ['rm', '-f', name]); } catch {}

  const args = ['run', '-d', '--name', name, '--network', 'host'];
  for (const p of (cfg.ports || [])) args.push('-p', p);
  for (const e of (cfg.env || [])) args.push('-e', e);
  if (cfg.cmd) args.push(...cfg.cmd);
  args.push(cfg.image);

  await run(RUNTIME, args);
}

async function checkContainer(container) {
  try {
    await run(RUNTIME, ['inspect', '--format={{.State.Status}}', container]);
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Service definitions
// ---------------------------------------------------------------------------
const services = {
  1: {
    name: 'PostgreSQL + TimescaleDB', icon: '\u{1F5C4}\uFE0F', type: 'docker', container: 'obs-postgres-1',
    start: () => composeUp('postgres'), stop: () => composeStop('postgres'),
    check: async () => checkContainer('obs-postgres-1'), port: 5432,
  },
  2: {
    name: 'Apache Kafka', icon: '\u{1F4E8}', type: 'docker', container: 'obs-kafka-1',
    start: () => composeUp('kafka'), stop: () => composeStop('kafka'),
    check: async () => checkContainer('obs-kafka-1'), port: 9092,
  },
  3: {
    name: 'OpenSearch', icon: '\u{1F50D}', type: 'docker', container: 'obs-opensearch-1',
    start: () => composeUp('opensearch'), stop: () => composeStop('opensearch'),
    check: async () => checkContainer('obs-opensearch-1'), port: 9200,
  },
  4: {
    name: 'MinIO Object Storage', icon: '\u{1F4E6}', type: 'docker', container: 'obs-minio-1',
    start: () => composeUp('minio'), stop: () => composeStop('minio'),
    check: async () => checkContainer('obs-minio-1'), port: 9000,
  },
  5: {
    name: 'Redis (Queue)', icon: '\u26A1', type: 'docker', container: 'obs-redis-1',
    start: () => composeUp('redis'), stop: () => composeStop('redis'),
    check: async () => checkContainer('obs-redis-1'), port: 6379,
  },
  6: {
    name: 'API Server (Fastify)', icon: '\u{1F310}', type: 'node',
    cwd: resolve(ROOT, 'api'), cmd: 'npx', args: ['tsx', 'src/index.ts'],
    check: async () => { try { const r = await fetch('http://localhost:4000/api/health'); return r.ok; } catch { return false; } },
    port: 4000,
  },
  7: {
    name: 'Dashboard (React + Vite)', icon: '\u{1F4CA}', type: 'node',
    cwd: resolve(ROOT, 'dashboard'), cmd: 'npx', args: ['vite', '--host'],
    check: async () => { try { const r = await fetch('http://localhost:3000'); return r.ok; } catch { return false; } },
    port: 3000,
  },
  8: {
    name: 'Analysis Engine (Python)', icon: '\u{1F9E0}', type: 'python',
    cwd: resolve(ROOT, 'analysis'), cmd: 'python3', args: ['-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', '8000'],
    check: async () => { try { const r = await fetch('http://localhost:8000/health'); return r.ok; } catch { return false; } },
    port: 8000,
  },
  9: {
    name: 'Collector Agent', icon: '\u{1F578}\uFE0F', type: 'node',
    cwd: resolve(ROOT, 'collector'), cmd: 'npx', args: ['tsx', 'src/index.ts'],
    check: async () => false,
    port: 0,
  },
  10: {
    name: 'Rust Processor', icon: '\u26A1', type: 'binary',
    cwd: resolve(ROOT, 'processing'), cmd: './observability-processor', args: [],
    check: async () => { try { const r = await fetch('http://localhost:9100/health'); return r.ok; } catch { return false; } },
    port: 9100,
  },
  11: {
    name: 'Rust API Server', icon: '\u{1F680}', type: 'binary',
    cwd: resolve(ROOT, 'api-rust'), cmd: './target/release/observability-api', args: [],
    env: { PORT: '4001', DATABASE_URL: 'postgres://obs:obspass@localhost:5432/observability', KAFKA_BROKERS: 'localhost:9093', OPENSEARCH_URL: 'http://localhost:9200', MINIO_ENDPOINT: 'localhost:9000', MINIO_ACCESS_KEY: 'minioadmin', MINIO_SECRET_KEY: 'minioadmin', JWT_SECRET: 'obs-platform-secret-change-in-production' },
    check: async () => { try { const r = await fetch('http://localhost:4001/health'); return r.ok; } catch { return false; } },
    port: 4001,
  },
};

const processes = {};

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------
app.get('/api/services', (req, res) => {
  res.json(Object.entries(services).map(([id, svc]) => ({
    id: parseInt(id), name: svc.name, icon: svc.icon,
    type: svc.type, port: svc.port,
    runtime: RUNTIME || 'none',
    running: processes[id]?.running ?? false,
  })));
});

app.post('/api/services/:id/start', async (req, res) => {
  const id = parseInt(req.params.id);
  const svc = services[id];
  if (!svc) return res.status(404).json({ error: 'Service not found' });
  if (!RUNTIME && svc.type === 'docker')
    return res.status(400).json({ error: 'No container runtime (docker/podman) found' });

  try {
    if (svc.type === 'docker') {
      await svc.start();
      await new Promise(r => setTimeout(r, 1000));
      const running = await svc.check();
      processes[id] = { running };
    } else {
      const proc = spawn(svc.cmd, svc.args, {
        cwd: svc.cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: false,
        env: { ...process.env, ...(svc.env || {}) },
      });
      proc.stdout.on('data', (d) => process.stdout.write('[' + svc.name + '] ' + d));
      proc.stderr.on('data', (d) => process.stderr.write('[' + svc.name + '] ' + d));
      proc.on('exit', () => { if (processes[id]) processes[id].running = false; });
      processes[id] = { proc, running: true };
    }
    res.json({ success: true, running: processes[id]?.running ?? false });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/services/:id/stop', async (req, res) => {
  const id = parseInt(req.params.id);
  const svc = services[id];
  if (!svc) return res.status(404).json({ error: 'Service not found' });

  try {
    if (svc.type === 'docker') {
      await svc.stop();
    } else if (processes[id]?.proc) {
      processes[id].proc.kill('SIGTERM');
      setTimeout(() => { try { processes[id].proc.kill('SIGKILL'); } catch {} }, 5000);
    }
    processes[id] = { ...processes[id], running: false };
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/services/:id/status', async (req, res) => {
  const id = parseInt(req.params.id);
  const svc = services[id];
  if (!svc) return res.status(404).json({ error: 'Service not found' });
  try {
    const running = await svc.check();
    if (processes[id]) processes[id].running = running;
    res.json({ id, running });
  } catch {
    res.json({ id, running: false });
  }
});

app.post('/api/run-migration', async (req, res) => {
  try {
    await run('npm', ['run', 'migrate'], { cwd: resolve(ROOT, 'api') });
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/start-all', async (req, res) => {
  const results = [];
  for (const [id, svc] of Object.entries(services)) {
    if (svc.type !== 'docker') continue;
    try {
      await svc.start();
      results.push({ id: parseInt(id), name: svc.name, success: true });
    } catch (err) {
      results.push({ id: parseInt(id), name: svc.name, success: false, error: err.message });
    }
  }
  res.json(results);
});

const PORT = parseInt(process.env.LAUNCHER_PORT || '7070');
app.listen(PORT, () => {
  console.log('\n  ALLSEER Sentinel Launcher');
  console.log('  http://localhost:' + PORT + '\n');
  if (!RUNTIME) console.log('  [WARN] No container runtime (docker/podman) found.\n');
  else console.log('  Runtime: ' + RUNTIME + (HAS_COMPOSE ? ' (compose)' : ' (fallback)') + '\n');
});
