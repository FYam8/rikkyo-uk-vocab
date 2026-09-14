import { defineConfig } from "vite";

export default defineConfig({
  base: "/rikkyo-uk-vocab/",
  build: {
    sourcemap: true,
    target: "es2022",
  },
});
