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

/** Step 1a: Upload seed file and generate ontology (returns project_id synchronously) */
async function generateOntology(seedFilePath: string, productName: string): Promise<string> {
  const formData = new FormData();
  const fileContent = fs.readFileSync(seedFilePath);
  const fileName = path.basename(seedFilePath);
  formData.append('files', new Blob([fileContent]), fileName);
  formData.append('project_name', productName);
  formData.append('simulation_requirement',
    `Generate a swarm simulation of ${productName} customers, analysts, and competitors ` +
    `to provide growth intelligence, market positioning insights, and competitive analysis.`);

  const res = await fetch(`${BASE_URL}/api/graph/ontology/generate`, {
    method: 'POST',
    body: formData,
  });

  const json = await res.json() as { success: boolean; data?: { project_id: string }; error?: string };
  if (!json.success) throw new Error(`Ontology generation failed: ${json.error ?? 'unknown'}`);
  const projectId = json.data?.project_id;
  if (!projectId) throw new Error('Ontology generation returned no project_id');
  return projectId;
}

/** Step 1b: Trigger async knowledge graph build for a project */
async function buildGraph(projectId: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/graph/build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId }),
  });

  const json = await res.json() as { success: boolean; data?: { task_id: string }; error?: string };
  if (!json.success) throw new Error(`Graph build failed: ${json.error ?? 'unknown'}`);
  const taskId = json.data?.task_id;
  if (!taskId) throw new Error('Graph build returned no task_id');
  return taskId;
}

/** Fetch project to extract graph_id after build completes */
async function getProjectGraphId(projectId: string): Promise<string> {
  const data = await apiGet(`/api/graph/project/${projectId}`) as { graph_id?: string };
  if (!data.graph_id) throw new Error(`Project ${projectId} has no graph_id after build`);
  return data.graph_id;
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
        spin.stop(`Knowledge graph built (task ${taskId})`);
        return { graph_id: data.graph_id ?? (data.result as any)?.graph_id ?? '' };
      }
      if (data.status === 'failed') {
        spin.stop('Graph build failed');
        throw new Error(`Graph task ${taskId} failed`);
      }
    } catch (e: any) {
      if (e?.message?.includes('failed')) throw e; // propagate real failures
      // transient network error — keep polling
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

  // Step 1a: Generate ontology (creates project, processes file)
  console.log('\n1️⃣  Generating ontology from seed file (may take 1–2 min)…');
  const projectId = await generateOntology(seedFilePath, productName);
  console.log(`  ✅ Ontology generated. Project ID: ${projectId}`);

  // Step 1b: Build knowledge graph (async)
  console.log('\n   Building knowledge graph…');
  const graphTaskId = await buildGraph(projectId);
  await pollGraphTask(graphTaskId);
  const graphId = await getProjectGraphId(projectId);
  console.log(`  ✅ Graph ID: ${graphId}`);

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
