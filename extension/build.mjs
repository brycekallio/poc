// Bundles src/ into dist/, the folder Chrome loads unpacked.
//
// Chrome runs content_scripts as classic scripts, so an ES `import` in one
// throws before anything else executes. Bundling each entry into a single IIFE
// fixes that and lets the worker use the Anthropic SDK.
//
// dist/ rather than this folder because Chrome refuses to load an extension
// containing files whose names start with "_", which node_modules has.
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
cpSync("static", "dist", { recursive: true });

// Geist (SIL OFL 1.1), bundled because host pages' CSP can block font URLs.
// The licence travels with the files.
mkdirSync("dist/fonts");
const geist = "node_modules/geist/dist/fonts";
for (const f of ["geist-sans/Geist-Regular.woff2", "geist-sans/Geist-Medium.woff2", "geist-sans/Geist-SemiBold.woff2", "geist-mono/GeistMono-Regular.woff2"])
  cpSync(`${geist}/${f}`, `dist/fonts/${f.split("/")[1]}`);
cpSync("node_modules/geist/LICENSE.txt", "dist/fonts/OFL.txt");

const ctx = await esbuild.context({
  entryPoints: { content: "src/content.js", worker: "src/worker.js", options: "src/options.js", popup: "src/popup.js" },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome120",
  loader: { ".css": "text" }, // panel.css becomes a string for the shadow root
  legalComments: "none",
  logLevel: "info",
});

if (watch) {
  await ctx.watch();
  console.log("Watching src/. static/ is copied once; rerun after editing it.");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
