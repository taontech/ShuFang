import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: [
      'shu.fang',   // 允许你自定义的域名访问
      'git.web'     // 如果另一个项目也是 Vite 启动的，也顺便加上
    ]
  }
});
