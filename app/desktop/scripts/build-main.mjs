import { build, context } from "esbuild";

const options = {
  entryPoints: ["src/main/main.ts", "src/preload/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  outbase: "src",
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  entryNames: "[dir]/[name]",
  sourcemap: true,
};

if (process.argv.includes("--watch")) {
  const buildContext = await context(options);
  await buildContext.watch();
  console.log("Watching Electron main and preload sources");
} else {
  await build(options);
}
