import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { loadEnv, type PluginOption } from "vite";
import { coverageConfigDefaults, defineConfig } from "vitest/config";

const ladybugWasmWorkerFileName = "lbug_wasm_worker.js";
const require = createRequire(import.meta.url);
const ladybugWasmCoreDirectory = dirname(
  require.resolve("@ladybugdb/wasm-core"),
);
const ladybugWasmWorkerPath = join(
  ladybugWasmCoreDirectory,
  "multithreaded",
  ladybugWasmWorkerFileName,
);

const crossOriginIsolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

const ladybugWasmWorkerPlugin = (): PluginOption => {
  return {
    name: "ladybug-wasm-worker",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split("?", 1)[0];
        if (!pathname?.endsWith(`/${ladybugWasmWorkerFileName}`)) {
          next();
          return;
        }

        response.statusCode = 200;
        response.setHeader("Content-Type", "text/javascript");
        response.setHeader(
          "Cross-Origin-Opener-Policy",
          crossOriginIsolationHeaders["Cross-Origin-Opener-Policy"],
        );
        response.setHeader(
          "Cross-Origin-Embedder-Policy",
          crossOriginIsolationHeaders["Cross-Origin-Embedder-Policy"],
        );
        createReadStream(ladybugWasmWorkerPath).pipe(response);
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: ladybugWasmWorkerFileName,
        source: readFileSync(ladybugWasmWorkerPath),
      });
    },
  };
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // Construct the URL for the express server used by the Vite dev server
  const expressServerUrl = (() => {
    const httpPort = env.PROXY_SERVER_HTTP_PORT || 80;
    const port = httpPort !== 80 ? `:${httpPort}` : "";
    const baseUrl = `http://localhost${port}`;
    return baseUrl;
  })();

  const htmlPlugin = (): PluginOption => {
    return {
      name: "html-transform",
      transformIndexHtml: {
        order: "pre",
        handler: (html: string) => {
          return html.replace(/%(.*?)%/g, function (_match, p1) {
            return env[p1] ? env[p1] : "";
          });
        },
      },
    };
  };

  return {
    server: {
      host: true,
      port: Number(env.GRAPH_EXP_DEV_PORT) || undefined,
      strictPort: !!env.GRAPH_EXP_DEV_PORT,
      headers: crossOriginIsolationHeaders,
      watch: {
        ignored: ["**/*.test.ts", "**/*.test.tsx"],
      },
      proxy: {
        // Forward API requests to the Express proxy server in dev mode so
        // the browser stays on the same origin and CORS is not needed.
        "^/(defaultConnection|gremlin|logger|openCypher|pg|rdf|sparql|status|summary)(/|$)":
          {
            target: expressServerUrl,
            changeOrigin: true,
          },
      },
    },
    preview: {
      headers: crossOriginIsolationHeaders,
    },
    base: env.GRAPH_EXP_ENV_ROOT_FOLDER,
    envPrefix: "GRAPH_EXP",
    define: {
      __GRAPH_EXP_VERSION__: JSON.stringify(process.env.npm_package_version),
    },

    plugins: [
      htmlPlugin(),
      tailwindcss(),
      react(),
      babel({
        presets: [reactCompilerPreset()],
      }),
      ladybugWasmWorkerPlugin(),
    ],
    resolve: {
      tsconfigPaths: true,
    },
    test: {
      globals: true,
      pool: "threads",

      // Setup
      globalSetup: ["src/globalSetup.ts"],
      setupFiles: ["src/setupTests.ts"],

      // Reset state between tests
      clearMocks: true,
      resetMocks: true,
      restoreMocks: true,
      unstubEnvs: true,
      unstubGlobals: true,

      coverage: {
        exclude: [
          "src/components/icons",
          "src/@types",
          "src/index.tsx",
          "src/App.ts",
          "src/setupTests.ts",
          "src/**/*.style.ts",
          "src/**/*.styles.ts",
          "src/**/*.styles.css.ts",
          "tailwind.config.ts",
          ...coverageConfigDefaults.exclude,
        ],
      },
    },
  };
});
