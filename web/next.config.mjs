/** @type {import('next').NextConfig} */
const nextConfig = {
  // Minimal self-contained server bundle for the production Docker image
  // (see ../Dockerfile.web) — without this, the image would need the full
  // node_modules tree instead of just what's actually reachable at runtime.
  output: 'standalone',
  // matrix-sdk-crypto-wasm ships a .wasm file that Next's default webpack
  // config doesn't know how to bundle without this.
  webpack: (config) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
};

export default nextConfig;
