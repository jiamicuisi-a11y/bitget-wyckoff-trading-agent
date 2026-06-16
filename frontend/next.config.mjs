/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 挂在 Nginx /quant/ 子路径下
  basePath: "/quant",
  // 自包含输出，部署到服务器只需 standalone + static，体积小、省内存
  output: "standalone",
};

export default nextConfig;
