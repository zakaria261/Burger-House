import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: { unoptimized: true },
  ...(process.env.SITES_EXPORT === '1' ? { output: 'export' as const } : {}),
};
export default nextConfig;
