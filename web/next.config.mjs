/** @type {import('next').NextConfig} */
const nextConfig = {
  // matrix-sdk-crypto-wasm ships a .wasm file that Next's default webpack
  // config doesn't know how to bundle without this.
  webpack: (config) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
};

export default nextConfig;
