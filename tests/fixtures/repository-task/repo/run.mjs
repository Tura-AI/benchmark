import fs from "node:fs";

fs.writeFileSync(
  "output.txt",
  fs.readFileSync("input.txt", "utf8").toUpperCase(),
);
