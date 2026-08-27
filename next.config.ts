import type {NextConfig} from 'next';

const pythonBackendUrl =
  process.env.PYTHON_BACKEND_URL?.trim() || 'http://127.0.0.1:8000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Proxy intelligence API to the Python FastAPI backend.
  // Filesystem routes take precedence — app/api/* TS handlers were removed.
  // Keep app/auth/callback as a Next route (not rewritten).
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${pythonBackendUrl}/api/:path*`,
      },
    ];
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
  webpack: (config, {dev}) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default nextConfig;
