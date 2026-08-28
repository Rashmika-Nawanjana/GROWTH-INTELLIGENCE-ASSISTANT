import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  // Keep Node-only OTel/Langfuse out of the browser/edge webpack graph.
  // Prefer sdk-trace-node over sdk-node (sdk-node pulls @grpc → stream/fs).
  serverExternalPackages: [
    '@opentelemetry/sdk-trace-node',
    '@opentelemetry/api',
    '@opentelemetry/core',
    '@langfuse/otel',
    '@langfuse/tracing',
    '@langfuse/langchain',
  ],
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Allow access to remote image placeholder.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**', // This allows any path under the hostname
      },
    ],
  },
  transpilePackages: ['motion'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy-Report-Only',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none';",
          },
        ],
      },
    ];
  },
  webpack: (config, { isServer, dev }) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify — file watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    // Client/edge builds must not try to polyfill Node stream/fs for @grpc.
    if (!isServer) {
      config.resolve = config.resolve ?? {};
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        stream: false,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        http2: false,
        child_process: false,
      };
    }
    return config;
  },
};

export default nextConfig;
