#!/usr/bin/env tsx
/**
 * MiroFish Bootstrap Script
 *
 * One-time setup per product.  Runs the full MiroFish pipeline:
 *   1. Upload seed material file  →  build knowledge graph
 *   2. Create simulation
 *   3. Prepare simulation environment (async, LLM-generated agent profiles)
 *   4. Start simulation
 *   5. Poll until ready for /interview/all calls
 *   6. Print the simulation_id + the env var line to copy into .env.local
 *
 * Usage:
 *   npx tsx scripts/mirofish-bootstrap.ts
 *
 * Prerequisites:
 *   - MiroFish backend running on MIROFISH_BASE_URL (default http://localhost:5001)
 *     Start with:  docker compose up -d  (inside the MiroFish repo)
 *   - MiroFish has LLM_API_KEY and ZEP_API_KEY set in its own .env
 *   - A seed material file (.txt, .md, or .pdf) with context about your product
 *
 * After running:
 *   - Copy the printed MIROFISH_SIMULATIONS line into your .env.local
 *   - Restart your dev server
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';

// ── Config ────────────────────────────────────────────────────────────────────

let BASE_URL = process.env.MIROFISH_BASE_URL ?? 'http://localhost:5001';
BASE_URL = BASE_URL.replace(/\/$/, '');

// ── Helpers ───────────────────────────────────────────────────────────────────

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function spinner(label: string): { stop: (msg: string) => void } {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const id = setInterval(() => {
    process.stdout.write(`\r${frames[i++ % frames.length]} ${label}`);
  }, 100);
  return {
    stop: (msg: string) => {
      clearInterval(id);
      process.stdout.write(`\r✅ ${msg}\n`);
    },
  };
}

async function apiPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json() as { success: boolean; data?: unknown; error?: string };
  if (!json.success) throw new Error(`${path} failed: ${json.error ?? 'unknown error'}`);
  return json.data;
}

async function apiGet(path: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`);
  const json = await res.json() as { success: boolean; data?: unknown; error?: string };
  if (!json.success) throw new Error(`${path} failed: ${json.error ?? 'unknown error'}`);
  return json.data;
}

// ── Pipeline steps ────────────────────────────────────────────────────────────

/** Step 1: Upload seed file and build knowledge graph */
async function buildGraph(seedFilePath: string, projectId: string): Promise<{ graph_id: string; task_id: string }> {
  const formData = new FormData();
  const fileContent = fs.readFileSync(seedFilePath);
  const fileName = path.basename(seedFilePath);
  formData.append('file', new Blob([fileContent]), fileName);
  formData.append('project_id', projectId);

  const res = await fetch(`${BASE_URL}/api/graph/build`, {
    method: 'POST',
    body: formData,
  });

  const json = await res.json() as { success: boolean; data?: { task_id: string; graph_id?: string }; error?: string };
  if (!json.success) throw new Error(`Graph build failed: ${json.error ?? 'unknown'}`);
  return { graph_id: json.data?.graph_id ?? '', task_id: json.data?.task_id ?? '' };
}

/** Poll graph task until completed */
async function pollGraphTask(taskId: string, timeoutMs = 180_000): Promise<{ graph_id: string }> {
  const spin = spinner(`Building knowledge graph (task ${taskId})…`);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await sleep(3_000);
    try {
      const data = await apiGet(`/api/graph/task/${taskId}`) as { status: string; graph_id?: string; result?: { graph_id?: string } };
      if (data.status === 'completed') {
        const graphId = data.graph_id ?? (data.result as any)?.graph_id ?? '';
        spin.stop(`Knowledge graph built: ${graphId}`);
        return { graph_id: graphId };
      }
      if (data.status === 'failed') {
        spin.stop('Graph build failed');
        throw new Error(`Graph task ${taskId} failed`);
      }
    } catch (e) {
      // transient error — keep polling
    }
  }

  spin.stop('Timed out waiting for graph build');
  throw new Error('Graph build timed out after 3 minutes');
}

/** Step 2 + 3 + 4: Create → Prepare → Start simulation */
async function createSimulation(projectId: string, graphId: string): Promise<string> {
  // Create
  const created = await apiPost('/api/simulation/create', {
    project_id: projectId,
    graph_id: graphId,
    enable_twitter: true,
    enable_reddit: true,
  }) as { simulation_id: string };
  console.log(`  Created simulation: ${created.simulation_id}`);
  return created.simulation_id;
}

async function prepareSimulation(simulationId: string, timeoutMs = 600_000): Promise<void> {
  const prepared = await apiPost('/api/simulation/prepare', { simulation_id: simulationId }) as { task_id?: string };
  const taskId = prepared.task_id;
  if (!taskId) {
    console.log('  No prepare task_id returned — assuming already prepared');
    return;
  }

  const spin = spinner(`Preparing simulation environment (${taskId}, may take 5–10 min)…`);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await sleep(5_000);
    try {
      const statusData = await apiPost('/api/simulation/prepare/status', { task_id: taskId }) as { status: string };
      if (statusData.status === 'completed') {
        spin.stop('Simulation environment prepared');
        return;
      }
      if (statusData.status === 'failed') {
        spin.stop('Preparation failed');
        throw new Error('Simulation preparation failed');
      }
    } catch {
      // keep polling on transient errors
    }
  }

  spin.stop('Timed out waiting for preparation');
  throw new Error('Simulation preparation timed out');
}

async function startSimulation(simulationId: string): Promise<void> {
  await apiPost('/api/simulation/start', { simulation_id: simulationId });
  console.log(`  Simulation started: ${simulationId}`);
}

/** Poll simulation status until it's ready for interviews */
async function waitForSimulationReady(simulationId: string, timeoutMs = 600_000): Promise<void> {
  const spin = spinner('Waiting for simulation to complete and enter interview mode…');
  const deadline = Date.now() + timeoutMs;
  const READY_STATES = ['completed', 'waiting_command', 'finished'];

  while (Date.now() < deadline) {
    await sleep(5_000);
    try {
      const res = await fetch(`${BASE_URL}/api/simulation/${simulationId}/run-status`);
      const json = await res.json() as { data?: { status?: string }; status?: string };
      const status = json?.data?.status ?? json?.status ?? '';
      if (READY_STATES.includes(status)) {
        spin.stop(`Simulation ready for interviews (status: ${status})`);
        return;
      }
    } catch {
      // keep polling
    }
  }

  spin.stop('Timed out — simulation may still be running');
  console.warn('  ⚠ Simulation did not reach ready state within timeout.');
  console.warn('    You can still configure the simulationId now and retry later.');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🐟 MiroFish Bootstrap — One-Time Setup\n');
  console.log(`Backend URL: ${BASE_URL}\n`);

  // Check backend is reachable
  try {
    await fetch(`${BASE_URL}/api/graph/project/list`, { signal: AbortSignal.timeout(5_000) });
  } catch {
    console.error(`❌ Cannot reach MiroFish backend at ${BASE_URL}`);
    console.error('   Start it with: docker compose up -d  (in the MiroFish repo directory)');
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let productName: string;
  let seedFilePath: string;

  try {
    productName = (await ask(rl, 'Product name (e.g. "Vector Agents"): ')).trim();
    if (!productName) throw new Error('Product name is required');

    seedFilePath = (await ask(rl, 'Path to seed material file (.txt/.md/.pdf): ')).trim();
    if (!seedFilePath) throw new Error('Seed file path is required');

    // Expand ~ if needed
    seedFilePath = seedFilePath.replace(/^~/, process.env.HOME ?? '');

    if (!fs.existsSync(seedFilePath)) {
      throw new Error(`File not found: ${seedFilePath}`);
    }
  } finally {
    rl.close();
  }

  console.log(`\n📦 Setting up simulation for "${productName}"…`);

  // Derive a project ID from the product name
  const projectId = `veracity-${productName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
  console.log(`  Project ID: ${projectId}`);

  // Step 1: Build knowledge graph
  console.log('\n1️⃣  Building knowledge graph…');
  const { task_id: graphTaskId } = await buildGraph(seedFilePath, projectId);
  const { graph_id: graphId } = await pollGraphTask(graphTaskId);
  if (!graphId) throw new Error('Graph build succeeded but returned no graph_id');

  // Step 2: Create simulation
  console.log('\n2️⃣  Creating simulation…');
  const simulationId = await createSimulation(projectId, graphId);

  // Step 3: Prepare simulation
  console.log('\n3️⃣  Preparing simulation (LLM generates agent profiles)…');
  await prepareSimulation(simulationId);

  // Step 4: Start simulation
  console.log('\n4️⃣  Starting simulation…');
  await startSimulation(simulationId);

  // Step 5: Wait for ready
  console.log('\n5️⃣  Waiting for simulation to be ready for interviews…');
  await waitForSimulationReady(simulationId);

  // Step 6: Print results
  const envKey = productName.toLowerCase().trim();
  const existingRaw = process.env.MIROFISH_SIMULATIONS ?? '{}';
  let existing: Record<string, string> = {};
  try { existing = JSON.parse(existingRaw); } catch {}
  existing[envKey] = simulationId;

  console.log('\n' + '='.repeat(60));
  console.log('✅  Done!\n');
  console.log(`Simulation ID:  ${simulationId}`);
  console.log('\nAdd this line to your .env.local:');
  console.log(`MIROFISH_SIMULATIONS=${JSON.stringify(existing)}`);
  console.log('\nThen restart your dev server (npm run dev).');
  console.log('='.repeat(60) + '\n');
}

main().catch(err => {
  console.error('\n❌ Bootstrap failed:', err.message ?? err);
  process.exit(1);
});
