import assert from "node:assert/strict";
import fs from "node:fs";

assert.equal(fs.readFileSync("output.txt", "utf8"), "FIXTURE\n");
console.log("valid");
