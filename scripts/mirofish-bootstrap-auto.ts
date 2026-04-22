#!/usr/bin/env tsx
/**
 * Non-interactive MiroFish bootstrap.
 * Usage:
 *   MIROFISH_BASE_URL=http://168.144.36.78:5001 \
 *   npx tsx scripts/mirofish-bootstrap-auto.ts "Vector Agents" scripts/seeds/vector-agents.txt
 */

import fs from 'fs';
import path from 'path';

let BASE_URL = (process.env.MIROFISH_BASE_URL ?? 'http://localhost:5001').replace(/\/$/, '');

const productName = process.argv[2]?.trim();
let seedFilePath  = process.argv[3]?.trim();

if (!productName) { console.error('Usage: npx tsx mirofish-bootstrap-auto.ts "Product Name" seed-file.txt'); process.exit(1); }
if (!seedFilePath) { console.error('Seed file path is required as second argument'); process.exit(1); }
seedFilePath = seedFilePath.replace(/^~/, process.env.HOME ?? '');
if (!fs.existsSync(seedFilePath)) { console.error(`File not found: ${seedFilePath}`); process.exit(1); }

// ── Helpers ────────────────────────────────────────────────────────────────────
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function apiPost(p: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json() as { success: boolean; data?: unknown; error?: string };
  if (!json.success) throw new Error(`${p} failed: ${json.error ?? 'unknown'}`);
  return json.data;
}

async function apiGet(p: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${p}`);
  const json = await res.json() as { success: boolean; data?: unknown; error?: string };
  if (!json.success) throw new Error(`${p} failed: ${json.error ?? 'unknown'}`);
  return json.data;
}

// ── Pipeline ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🐟 MiroFish Bootstrap (auto) — ${productName}\nBackend: ${BASE_URL}\n`);

  // Reachability check
  try { await fetch(`${BASE_URL}/api/graph/project/list`, { signal: AbortSignal.timeout(5_000) }); }
  catch { console.error(`Cannot reach ${BASE_URL}`); process.exit(1); }

  // Step 1a: Generate ontology (trim seed so Groq on-demand TPM limits are not exceeded)
  const maxBytes = parseInt(process.env.MIROFISH_ONTOLOGY_MAX_BYTES ?? '800', 10);
  const raw = fs.readFileSync(seedFilePath);
  const fileContent =
    raw.length > maxBytes
      ? Buffer.concat([raw.subarray(0, maxBytes), Buffer.from('\n\n[...truncated to fit provider TPM limits]')])
      : raw;
  if (raw.length > maxBytes) {
    console.log(`   (Using first ${maxBytes} bytes of seed; set MIROFISH_ONTOLOGY_MAX_BYTES to change.)`);
  }
  console.log('1️⃣  Generating ontology (1-2 min)…');
  const formData = new FormData();
  formData.append('files', new Blob([fileContent]), path.basename(seedFilePath));
  formData.append('project_name', productName);
  formData.append(
    'simulation_requirement',
    `Swarm simulation of ${productName} users and competitors for growth and positioning insights.`
  );
  const res = await fetch(`${BASE_URL}/api/graph/ontology/generate`, { method: 'POST', body: formData });
  const ontJson = await res.json() as { success: boolean; data?: { project_id: string }; error?: string };
  if (!ontJson.success) throw new Error(`Ontology failed: ${ontJson.error}`);
  const projectId = ontJson.data!.project_id;
  console.log(`  ✅ Project ID: ${projectId}`);

  // Step 1b: Build graph
  console.log('   Building knowledge graph…');
  const buildRes = await fetch(`${BASE_URL}/api/graph/build`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: projectId }) });
  const buildJson = await buildRes.json() as { success: boolean; data?: { task_id: string }; error?: string };
  if (!buildJson.success) throw new Error(`Graph build failed: ${buildJson.error}`);
  const taskId = buildJson.data!.task_id;

  const deadline = Date.now() + 180_000;
  let graphId = '';
  while (Date.now() < deadline) {
    await sleep(4_000);
    const t = await apiGet(`/api/graph/task/${taskId}`) as { status: string; graph_id?: string; result?: { graph_id?: string } };
    if (t.status === 'completed') { graphId = t.graph_id ?? (t.result as any)?.graph_id ?? ''; break; }
    if (t.status === 'failed') throw new Error('Graph build task failed');
    process.stdout.write('.');
  }
  if (!graphId) {
    // fallback: fetch graph_id from project
    const proj = await apiGet(`/api/graph/project/${projectId}`) as { graph_id?: string };
    graphId = proj.graph_id ?? '';
  }
  console.log(`\n  ✅ Graph ID: ${graphId}`);

  // Step 2: Create simulation
  console.log('\n2️⃣  Creating simulation…');
  const created = await apiPost('/api/simulation/create', { project_id: projectId, graph_id: graphId, enable_twitter: true, enable_reddit: true }) as { simulation_id: string };
  const simulationId = created.simulation_id;
  console.log(`  ✅ Simulation ID: ${simulationId}`);

  // Step 3: Prepare simulation
  console.log('\n3️⃣  Preparing simulation (5-10 min)…');
  const prepared = await apiPost('/api/simulation/prepare', { simulation_id: simulationId }) as { task_id?: string };
  const prepTaskId = prepared.task_id;
  if (prepTaskId) {
    const prepDeadline = Date.now() + 600_000;
    while (Date.now() < prepDeadline) {
      await sleep(5_000);
      try {
        const s = await apiPost('/api/simulation/prepare/status', { task_id: prepTaskId }) as { status: string };
        if (s.status === 'completed') break;
        if (s.status === 'failed') throw new Error('Preparation failed');
        process.stdout.write('.');
      } catch (e: any) { if (e?.message?.includes('failed')) throw e; }
    }
    console.log('\n  ✅ Preparation complete');
  }

  // Step 4: Start simulation
  console.log('\n4️⃣  Starting simulation…');
  await apiPost('/api/simulation/start', { simulation_id: simulationId });
  console.log(`  ✅ Simulation started`);

  // Step 5: Wait for ready
  console.log('\n5️⃣  Waiting for simulation to complete…');
  const readyStates = ['completed', 'waiting_command', 'finished'];
  const readyDeadline = Date.now() + 600_000;
  while (Date.now() < readyDeadline) {
    await sleep(6_000);
    try {
      const r = await fetch(`${BASE_URL}/api/simulation/${simulationId}/run-status`);
      const j = await r.json() as { data?: { status?: string; runner_status?: string } };
      const status = j?.data?.status ?? j?.data?.runner_status ?? '';
      process.stdout.write(` [${status}]`);
      if (readyStates.includes(status)) break;
    } catch { /* keep polling */ }
  }
  console.log('\n  ✅ Simulation ready');

  // Print result
  const envKey = productName.toLowerCase().trim();
  const simMap: Record<string, string> = {};
  simMap[envKey] = simulationId;
  // also add common variants
  simMap['lilian'] = simulationId;
  simMap['the product'] = simulationId;
  simMap['vectoragents'] = simulationId;
  simMap['vector'] = simulationId;
  simMap['ai sdr'] = simulationId;

  console.log('\n' + '='.repeat(60));
  console.log('✅  Done!\n');
  console.log(`Simulation ID: ${simulationId}`);
  console.log('\nAdd these to your .env.local:');
  console.log(`MIROFISH_LIVE_BASE_URL=${BASE_URL}`);
  console.log(`MIROFISH_LIVE_SIMULATIONS=${JSON.stringify(simMap)}`);
  console.log('='.repeat(60) + '\n');
}

main().catch(err => { console.error('\n❌ Bootstrap failed:', err.message ?? err); process.exit(1); });
