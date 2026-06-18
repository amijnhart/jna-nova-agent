#!/usr/bin/env node
// Eén commando dat al je wijzigingen automatisch naar GitHub pusht.
// Gebruik:  npm run push          (gebruikt een standaard commit-bericht)
//           npm run push "tekst"  (eigen commit-bericht)
// Daarna zet Vercel de nieuwe versie binnen ~1 minuut vanzelf live.

import { execSync } from "child_process";

const msg =
  process.argv.slice(2).join(" ").trim() ||
  `NOVA update ${new Date().toLocaleString("nl-NL")}`;

function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

try {
  run("git add -A");
  // Alleen committen als er echt iets veranderd is
  const changed = execSync("git status --porcelain").toString().trim();
  if (!changed) {
    console.log("Niets gewijzigd — niets te pushen.");
    process.exit(0);
  }
  run(`git commit -m "${msg.replace(/"/g, "'")}"`);
  run("git push");
  console.log("\nKlaar. Vercel zet de nieuwe versie nu automatisch live op jna-events.nl/agents");
} catch (err) {
  console.error("\nPushen mislukt. Heb je de repo al gekoppeld? Zie README stap 2.");
  process.exit(1);
}
