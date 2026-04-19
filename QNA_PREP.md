# Veracity AI - Q&A Prep Sheet

## 1) Fast Intro (30-45 sec)

**Q: What did you build?**
A: We built Veracity AI, a multi-agent growth intelligence assistant. Instead of one chatbot response, it runs specialist agents in parallel, each collecting live external signals, then synthesizes findings into inline artifacts inside a single chat interface.

**Q: What problem does this solve?**
A: Product and growth teams usually spend hours stitching market evidence from scattered sources. This compresses that into minutes with sourced claims, confidence levels, and actionable recommendations.

## 2) Product + UX Questions

**Q: Why single-page chat instead of a dashboard?**
A: The conversation is the workflow. We keep context, stream progress, and render artifacts inline so users can ask follow-ups without losing analytical state.

**Q: How do users trust outputs?**
A: We enforce source grounding and confidence scoring in structured outputs. Every domain output includes facts, interpretation, confidence, and source URLs.

**Q: What makes this not just another chatbot?**
A: Three things: true multi-agent fan-out, live tool-driven evidence collection, and interface-level artifacts (charts/cards/matrices) rendered directly in chat.

## 3) Multi-Agent Architecture Questions

**Q: How many agents and what do they do?**
A: Six domain agents: market-trends, competitive, win-loss, pricing, positioning, and adjacent-market collision.

**Q: How are agents coordinated?**
A: The orchestrator classifies intent + domains, builds shared context, runs selected agents in parallel, tracks agent status, then synthesizes a final answer.

**Q: Why parallel execution?**
A: It reduces latency and increases analytical breadth in one turn. Independent domains can run concurrently, then be merged.

**Q: How do you handle one agent failing?**
A: Graceful degradation. Failed agents are marked as failed, but other agents complete and synthesis continues using available outputs.

## 4) Memory + State Management Questions

**Q: How do you maintain conversation memory?**
A: We keep session history in client state and send history with each /api/chat request. This gives short-term conversational continuity.

**Q: What about long-term memory across sessions?**
A: We persist user memory in Supabase and build a memory context string that is injected into orchestration/classification prompts for future turns and sessions.

**Q: What exactly is stored in persistent memory?**
A: Role, company, products, competitors, interests, notable facts, and a raw summary, plus timestamps.

**Q: When is memory updated?**
A: After assistant responses, we asynchronously call /api/memory to extract and merge new memory so UI responsiveness is not blocked.

## 5) Data + Grounding Questions

**Q: What live sources do you use?**
A: SerpAPI, Firecrawl, Reddit signals, and HN Algolia, with additional tool modules for ad intel and adjacent signal gathering.

**Q: How do you separate fact vs interpretation?**
A: Agent outputs are typed with separate facts and interpretation arrays, then synthesis uses both while preserving confidence and sources.

**Q: How do you prevent hallucination?**
A: Tool-first retrieval, schema constraints, confidence labels, and source-backed fact extraction before synthesis.

## 6) Technical Stack Questions

**Q: What stack did you use?**
A: Next.js 15, React 19, TypeScript, Tailwind CSS 4, Supabase, and Gemini via @google/genai.

**Q: Why this stack?**
A: Fast iteration for hackathon speed, strong typing for agent schemas, real-time UX with streaming endpoints, and simple managed persistence through Supabase.

**Q: How is streaming handled?**
A: /api/chat streams chunks to the frontend, including agent status updates and final result payload, which updates UI progressively.

## 7) Reliability + Failure Questions

**Q: What happens if tools return empty or fail?**
A: Agents use fallbacks where possible and return partial outputs. Orchestrator still synthesizes from available domains.

**Q: How do you debug bad outputs?**
A: We inspect per-agent outputs, confidence, and source arrays. The typed structure makes it easy to isolate weak domains.

**Q: Is this production-ready?**
A: It is a strong hackathon-grade foundation. For production, we would add stronger evals, caching strategy, quotas, and deeper observability.

## 8) Security + Privacy Questions

**Q: How do you protect secrets?**
A: API keys remain server-side. Client delegates sensitive tasks to API routes.

**Q: How is user data handled?**
A: Session/memory data is persisted in Supabase per authenticated user context; memory updates are controlled via backend routes.

## 9) Scalability + Cost Questions

**Q: How does this scale?**
A: Stateless API routes + parallelized agent calls scale horizontally. Persistence is separated in Supabase.

**Q: What are the main cost drivers?**
A: LLM tokens and external tool calls. We can reduce cost with domain selection, caching repeated lookups, and tighter summarization.

**Q: How would you optimize latency next?**
A: Smarter domain routing, cached source snapshots for repeated products, and timeout budgets per tool call.

## 10) Demo/Judge-Oriented Questions

**Q: What is the strongest proof this is multi-agent?**
A: Live agent status transitions and domain-specific outputs appearing in parallel, not a single monolithic answer.

**Q: How do you show impact in demo?**
A: Ask a broad strategic question, show parallel domain outputs + inline artifacts, then ask a follow-up to demonstrate memory continuity.

**Q: How does it generalize beyond Vector Agents?**
A: Product identity is inferred/classified from prompt + context, and agents are domain-based, not hardcoded to one company.

## 11) Honest Tradeoffs (Good to say in Q&A)

- We prioritized end-to-end workflow and explainability over perfect depth in any one domain.
- We currently rely on external source availability and API health.
- Long-horizon benchmarking/evaluation can be expanded with offline test suites.

## 12) Strong Closing Line

"We built a system that turns growth research from manual, fragmented work into a live multi-agent intelligence loop: fetch, reason, synthesize, and act - with traceable evidence and memory continuity."

## 13) Rapid-Fire One-Liners

- "Not one model call - coordinated specialist agents."
- "Not static answers - live-source grounded intelligence."
- "Not memoryless chat - session plus persistent user memory."
- "Not plain text dumps - inline strategic artifacts."
- "Graceful degradation - partial intelligence is still delivered when one agent fails."
