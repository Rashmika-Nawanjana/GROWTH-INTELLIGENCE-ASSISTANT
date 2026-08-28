export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.LANGFUSE_ENABLED !== 'true') return;

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();
  if (!publicKey || !secretKey) return;

  try {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
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

    const sdk = new NodeSDK({
      spanProcessors: [processor],
    });

    sdk.start();

    const { trace } = await import('@opentelemetry/api');
    const { setLangfuseTracerProvider } = await import('@langfuse/tracing');
    setLangfuseTracerProvider(trace.getTracerProvider());
  } catch (err) {
    console.warn(
      '[instrumentation] Langfuse OTel init failed:',
      err instanceof Error ? err.message : err,
    );
  }
}
