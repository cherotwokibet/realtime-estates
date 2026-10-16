import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@realtor/domain', '@realtor/demo', '@realtor/api-client'],
};
export default config;
