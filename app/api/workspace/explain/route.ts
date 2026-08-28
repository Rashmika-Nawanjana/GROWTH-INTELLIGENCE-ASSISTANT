import { NextRequest, after } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { generateHuggingFaceText } from '@/lib/agents/gemini';
import type { AgentOutput } from '@/lib/agents/types';
import { retrieveEvidenceWithTimeout } from '@/lib/evidence/retrieve';
import {
  countWorkspaceChunks,
  indexWorkspaceArtifact,
} from '@/lib/workspace/index-artifact';
import { isWorkspaceRagEnabled } from '@/lib/workspace/rag-config';
import { retrieveWorkspaceChunksWithTimeout } from '@/lib/workspace/retrieve';
import { runWithUsageLedger } from '@/lib/observability/usage-ledger';
import { flushLangfuse, runWithLangfuseTrace } from '@/lib/observability/langfuse';

export const runtime = 'nodejs';
export const maxDuration = 60;

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function summarizePayloadMeta(payload: AgentOutput): string {
  return JSON.stringify(
    {
      artifactType: payload.artifactType,
      domain: payload.domain,
      confidence: payload.confidence,
      confidenceScore: payload.confidenceScore,
      factCount: payload.facts?.length ?? 0,
      interpretationCount: payload.interpretation?.length ?? 0,
      sourceCount: payload.sources?.length ?? 0,
    },
    null,
    2,
  );
}

function summarizePayload(payload: AgentOutput): string {
  const base = {
    artifactType: payload.artifactType,
    domain: payload.domain,
    confidence: payload.confidence,
    confidenceScore: payload.confidenceScore,
    facts: payload.facts?.slice(0, 12) ?? [],
    interpretation: payload.interpretation?.slice(0, 8) ?? [],
    sources: (payload.sources ?? []).slice(0, 10).map(s => ({
      title: s.title,
      url: s.url,
      tool: s.tool,
    })),
  };

  const extra: Record<string, unknown> = { ...payload };
  delete extra.facts;
  delete extra.interpretation;
  delete extra.sources;
  delete extra.agentId;
  delete extra.domain;
  delete extra.confidence;
  delete extra.confidenceScore;
  delete extra.generatedAt;
  delete extra.artifactType;
  delete extra.evidence;
  delete extra.toolCallCount;
  delete extra.searchCallCount;
  delete extra.scrapeCallCount;
  delete extra.droppedIrrelevantCount;

  return JSON.stringify({ ...base, data: extra }, null, 2).slice(0, 12000);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return jsonError('Not authenticated', 401);
  }

  let body: { itemId?: string; question?: string; chartType?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const itemId = (body.itemId ?? '').trim();
  const question = (body.question ?? '').trim();
  const chartType = (body.chartType ?? 'native').trim();

  if (!itemId) return jsonError('itemId is required', 400);
  if (question.length < 2) return jsonError('question is required', 400);

  const { data: item, error: itemError } = await supabase
    .from('workspace_items')
    .select('*')
    .eq('id', itemId)
    .eq('user_id', user.id)
    .single();

  if (itemError || !item) {
    return jsonError('Workspace item not found', 404);
  }

  const payload = item.payload as AgentOutput;

  if (isWorkspaceRagEnabled()) {
    const chunkCount = await countWorkspaceChunks(supabase, itemId);
    if (chunkCount === 0) {
      await indexWorkspaceArtifact(supabase, {
        userId: user.id,
        workspaceItemId: item.id,
        workspaceId: item.workspace_id as string | null,
        title: String(item.title),
        artifactType: String(item.artifact_type),
        product: String(item.product ?? ''),
        payload,
        notes: item.notes as string | null,
      });
    }
  }

  const { data: prior } = await supabase
    .from('workspace_item_messages')
    .select('role, content')
    .eq('item_id', itemId)
    .order('created_at', { ascending: true })
    .limit(20);

  const { data: memory } = await supabase
    .from('user_memory')
    .select('role, company, products, competitors, interests, raw_summary')
    .eq('user_id', user.id)
    .maybeSingle();

  const memoryBlock = memory
    ? `User context:
- Role: ${memory.role ?? 'unknown'}
- Company: ${memory.company ?? 'unknown'}
- Products: ${(memory.products as string[] | null)?.join(', ') ?? 'n/a'}
- Competitors: ${(memory.competitors as string[] | null)?.join(', ') ?? 'n/a'}
- Interests: ${(memory.interests as string[] | null)?.join(', ') ?? 'n/a'}
- Summary: ${memory.raw_summary ?? 'n/a'}`
    : 'User context: none stored yet.';

  const history = (prior ?? [])
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const [workspaceRag, evidenceRag] = await Promise.all([
    retrieveWorkspaceChunksWithTimeout(supabase, {
      userId: user.id,
      query: question,
      workspaceItemId: itemId,
      workspaceId: item.workspace_id as string | null,
      product: String(item.product ?? ''),
    }),
    retrieveEvidenceWithTimeout(supabase, {
      userId: user.id,
      query: question,
      product: String(item.product ?? ''),
      domain: payload.domain,
      matchCount: 4,
    }),
  ]);

  const ragEnabled = isWorkspaceRagEnabled();
  const hasWorkspaceHits =
    workspaceRag.itemHits.length > 0 || workspaceRag.boardHits.length > 0;

  const artifactContext = ragEnabled && hasWorkspaceHits
    ? [
        '[WORKSPACE ARTIFACT — this item]',
        `Title: ${item.title}`,
        `Product: ${item.product ?? ''}`,
        `Competitor: ${item.competitor ?? 'n/a'}`,
        `Artifact type: ${item.artifact_type}`,
        `Chart view: ${chartType}`,
        `Metadata: ${summarizePayloadMeta(payload)}`,
        '',
        workspaceRag.itemContextBlock,
        workspaceRag.boardContextBlock,
      ]
        .filter(Boolean)
        .join('\n')
    : `ARTIFACT PAYLOAD (JSON):\n${summarizePayload(payload)}`;

  const evidenceBlock = evidenceRag.contextBlock
    ? `\n${evidenceRag.contextBlock}\n`
    : '';

  const prompt = `You are a growth intelligence analyst helping the user understand a saved workspace artifact.
Answer ONLY from the artifact data and its sources below. Do not invent facts or call tools.
If something is not in the data, say so clearly.
When you reference a claim, cite the source title/URL if available.
Keep the answer concise (3-8 short paragraphs or a tight bullet list).
The user is currently viewing this artifact as chart type: "${chartType}".
Briefly acknowledge what that view emphasizes when relevant.

${memoryBlock}

${artifactContext}
${evidenceBlock}
${history ? `PRIOR THREAD:\n${history}\n` : ''}
User question: ${question}

Write a clear, grounded answer:`;

  const retrievedSectionCount =
    workspaceRag.itemHits.length +
    workspaceRag.boardHits.filter(
      h => h.workspaceItemId !== itemId,
    ).length;

  try {
    await supabase.from('workspace_item_messages').insert({
      item_id: itemId,
      role: 'user',
      content: question,
    });

    const { result: answer } = await runWithLangfuseTrace(
      {
        name: 'workspace-explain',
        input: { question: question.slice(0, 200), itemId, chartType },
        userId: user.id,
        tags: ['workspace', 'explain'],
        metadata: { workspaceItemId: itemId, artifactType: payload.artifactType },
        asType: 'span',
      },
      async () => {
        const text = await runWithUsageLedger(
          { userId: user.id, queryPreview: question.slice(0, 120) },
          () => generateHuggingFaceText(prompt, {
            maxNewTokens: 1200,
            temperature: 0.3,
            stage: 'workspace-explain',
          }),
        );
        return text;
      },
    );

    const trimmed = (answer ?? '').trim();
    if (!trimmed) {
      return jsonError('Model returned an empty answer', 502);
    }

    const { data: saved } = await supabase
      .from('workspace_item_messages')
      .insert({
        item_id: itemId,
        role: 'assistant',
        content: trimmed,
      })
      .select('id')
      .single();

    after(async () => { await flushLangfuse(); });

    return new Response(
      JSON.stringify({
        answer: trimmed,
        messageId: saved?.id ?? null,
        retrievedSectionCount: ragEnabled ? retrievedSectionCount : 0,
        retrievedEvidenceCount: evidenceRag.hits.length,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Explanation failed';
    return jsonError(msg, 500);
  }
}
