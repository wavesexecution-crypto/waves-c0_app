// Copies the Prisma query engine + schema next to every emitted server
// asset (.next/server/**) and registers them in each .nft.json trace so
// Vercel includes them in every serverless lambda. Prisma's runtime resolves
// its engine relative to the bundled client (which lands in .next/server),
// so without this every DB call crashes with "could not locate the Query
// Engine". Runs after `next build`.
import { readdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = join(scriptDir, "..");
const generatedDir = join(appRoot, "..", "..", "packages", "db", "src", "generated", "client");
const serverDir = join(appRoot, ".next", "server");

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else if (entry.name.endsWith(".nft.json")) out.push(p);
  }
  return out;
}

async function main() {
  let files = [];
  try {
    files = (await readdir(generatedDir)).filter(
      (f) => f === "schema.prisma" || /query_engine|engine-|\.wasm/.test(f),
    );
  } catch (e) {
    console.error("[copy-prisma-engine] generated client not found:", generatedDir);
    process.exit(1);
  }

  // Prisma's runtime searches .next/server (the dirname of the bundled
  // client), so always put the engine there even before processing traces.
  for (const f of files) {
    await copyFile(join(generatedDir, f), join(serverDir, f));
  }

  const nfts = await walk(serverDir);
  if (nfts.length === 0) {
    console.log("[copy-prisma-engine] no .nft.json traces found; copied engine to .next/server only");
    return;
  }

  let copies = 0;
  for (const nftPath of nfts) {
    const dir = dirname(nftPath);
    const nft = JSON.parse(await readFile(nftPath, "utf8"));
    for (const f of files) {
      await copyFile(join(generatedDir, f), join(dir, f));
      if (!nft.files.includes(f)) nft.files.push(f);
      copies++;
    }
    await writeFile(nftPath, JSON.stringify(nft));
  }
  console.log(`[copy-prisma-engine] registered ${files.length} files in ${nfts.length} traces (${copies} copies)`);
}

main().catch((e) => {
  console.error("[copy-prisma-engine] failed:", e);
  process.exit(1);
});