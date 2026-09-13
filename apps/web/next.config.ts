import type { NextConfig } from 'next';

const config: NextConfig = {
  // Windows + pnpm symlinks can prevent Next from copying standalone traces.
  // Docker builds set DOCKER_BUILD=true and retain the optimized output.
  ...(process.env.DOCKER_BUILD === 'true' ? { output: 'standalone' as const } : {}),
};

export default config;
