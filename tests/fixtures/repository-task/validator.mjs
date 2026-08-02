import fs from "node:fs";
import path from "node:path";

export function validate({ workspace }) {
  return {
    adapter: "fixture-validator",
    passed:
      fs.readFileSync(path.join(workspace, "output.txt"), "utf8") ===
      "FIXTURE\n",
  };
}
