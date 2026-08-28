export async function register() {
  // Only load Node OTel/Langfuse on the Node runtime — never on Edge/client.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  await import('./instrumentation.node').then((m) => m.registerNodeInstrumentation());
}
