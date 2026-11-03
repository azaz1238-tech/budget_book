import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 개발 서버는 /api 요청을 FastAPI로 넘긴다. 8000이 아닌 포트면 BUDGET_API_URL로 지정한다.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": process.env.BUDGET_API_URL || "http://127.0.0.1:8000",
    },
  },
});
