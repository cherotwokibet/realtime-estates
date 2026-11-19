import type { NextConfig } from 'next';
import path from 'node:path';
const config: NextConfig = {
  output: 'standalone',
  serverExternalPackages: [
    '@google-cloud/cloud-sql-connector',
    'google-auth-library',
    'firebase-admin',
    'pg',
  ],
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
  poweredByHeader: false,
  transpilePackages: ['@realtor/domain', '@realtor/demo', '@realtor/api-client'],
};
export default config;
