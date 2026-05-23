import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Source uses NodeNext-style ".js" extensions on relative imports; rewrite
    // them to extensionless so Vite resolves the ".ts" sources during tests.
    alias: [{ find: /^(\.{1,2}\/.*)\.js$/, replacement: "$1" }],
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
