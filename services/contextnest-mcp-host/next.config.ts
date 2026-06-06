import type { NextConfig } from 'next';

const config: NextConfig = {
  serverExternalPackages: ['@promptowl/contextnest-engine'],
  webpack(webpackConfig) {
    // Allow .js imports to resolve .ts source files (TypeScript ESM convention)
    webpackConfig.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
    return webpackConfig;
  },
};

export default config;
