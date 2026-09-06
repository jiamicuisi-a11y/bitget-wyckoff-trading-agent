/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep `next dev` isolated from production builds. Running both against the
  // same cache can leave webpack references pointing at missing chunks.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  output: 'standalone',
}
export default nextConfig
