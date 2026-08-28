export type OrchestratorBackend = 'legacy' | 'langgraph';

export function getOrchestratorBackend(
  env: Record<string, string | undefined> = process.env,
): OrchestratorBackend {
  return (env.ORCHESTRATOR_BACKEND ?? 'legacy').trim().toLowerCase() === 'langgraph'
    ? 'langgraph'
    : 'legacy';
}
