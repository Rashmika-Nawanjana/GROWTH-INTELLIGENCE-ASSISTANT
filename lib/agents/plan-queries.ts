/**
 * Helpers for agents to consume ResearchPlan fields without duplicating logic.
 */

import type { AgentContext } from '../agents/types';

/**
 * Prefer planner queries over template strings. Returns up to `limit` queries,
 * falling back to `templates` when the plan is empty.
 */
export function resolveSearchQueries(
  ctx: AgentContext,
  templates: string[],
  limit = 2,
): string[] {
  const planned = (ctx.plannedQueries ?? []).filter(q => q.trim().length > 3);
  if (planned.length > 0) {
    return planned.slice(0, limit);
  }
  return templates.filter(q => q.trim().length > 3).slice(0, limit);
}

/**
 * Entity probes: skip when the shared planner already discovered entities
 * (those were searched in the pre-pass).
 */
export function resolveEntityProbes(
  ctx: AgentContext,
  templateProbes: string[],
  limit = 2,
): string[] {
  if ((ctx.discoveredEntities?.length ?? 0) > 0) {
    return [];
  }
  return templateProbes.filter(q => q.trim().length > 3).slice(0, limit);
}

/**
 * Gap-round queries: prefer planner gapQueries, else empty (caller may fall back
 * to candidate verification).
 */
export function resolveGapQueries(ctx: AgentContext, limit = 3): string[] {
  return (ctx.gapQueries ?? []).filter(q => q.trim().length > 3).slice(0, limit);
}
