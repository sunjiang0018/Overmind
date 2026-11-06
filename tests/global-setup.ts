import { execFileSync } from "node:child_process";

export default function setup() {
  execFileSync(process.execPath, ["node_modules/vite-plus/bin/vp", "run", "build"], {
    stdio: "inherit",
  });
}
