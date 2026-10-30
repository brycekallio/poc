// Builds dist/ and zips its contents for a GitHub release or the Chrome Web
// Store. manifest.json has to sit at the top of the zip.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

const zip = "poc-extension.zip";
execFileSync("node", ["build.mjs"], { stdio: "inherit" });
rmSync(zip, { force: true });
execFileSync("zip", ["-qr", `../${zip}`, ".", "-x", "*.DS_Store"], { cwd: "dist" });
console.log(`Wrote extension/${zip}`);
