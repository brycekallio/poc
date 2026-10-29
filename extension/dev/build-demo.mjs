// Builds preview/demo.html: dev/demo.html with the bundled demo script inlined.
import * as esbuild from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const out = await esbuild.build({
  entryPoints: ["dev/demo.js"], bundle: true, write: false, format: "esm", target: "chrome120",
  loader: { ".css": "text", ".woff2": "dataurl" }, minify: true, logLevel: "warning",
});
mkdirSync("preview", { recursive: true });
const js = out.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
writeFileSync("preview/demo.html", readFileSync("dev/demo.html", "utf8").replace("<script>/*DEMO*/</script>", () => `<script type="module">${js}</script>`));
console.log("preview/demo.html");
