/**
 * Node-only Langfuse / OpenTelemetry bootstrap.
 * Uses sdk-trace-node (not sdk-node) so Next never pulls @grpc / stream / fs.
 */
export async function registerNodeInstrumentation() {
  if (process.env.LANGFUSE_ENABLED !== 'true') return;

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();
  if (!publicKey || !secretKey) return;

  try {
    const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
    const { LangfuseSpanProcessor } = await import('@langfuse/otel');
    const { registerLangfuseSpanProcessor } = await import('./lib/observability/langfuse');

    const baseUrl =
      process.env.LANGFUSE_BASE_URL?.trim() ||
      process.env.LANGFUSE_HOST?.trim() ||
      'https://cloud.langfuse.com';

    const processor = new LangfuseSpanProcessor({
      publicKey,
      secretKey,
      baseUrl,
      environment: process.env.NODE_ENV ?? 'development',
    });

    registerLangfuseSpanProcessor(processor);

    const provider = new NodeTracerProvider({
      spanProcessors: [processor],
    });
    provider.register();

    const { setLangfuseTracerProvider } = await import('@langfuse/tracing');
    setLangfuseTracerProvider(provider);
  } catch (err) {
    console.warn(
      '[instrumentation] Langfuse OTel init failed:',
      err instanceof Error ? err.message : err,
    );
  }
}
