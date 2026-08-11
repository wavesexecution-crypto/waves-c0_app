// Copies the Prisma query engine + schema into .next/server (Prisma's runtime
// search path for the bundled client) and registers it in every .nft.json
// trace via relative paths, so Vercel includes it in each serverless lambda.
//
// Prisma resolves its engine relative to the bundled client (__dirname lands
// in .next/server), so without this every DB call crashes with "could not
// locate the Query Engine". Runs after `next build`.
import { readdir, readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
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

  // 1) Put the engine + schema at .next/server root — the exact dir Prisma's
  // bundled client searches.
  for (const f of files) {
    await copyFile(join(generatedDir, f), join(serverDir, f));
  }

  // 2) Register the .next/server copies in every trace via a relative path.
  const nfts = await walk(serverDir);
  let registered = 0;
  for (const nftPath of nfts) {
    const dir = dirname(nftPath);
    const nft = JSON.parse(await readFile(nftPath, "utf8"));
    let changed = false;
    for (const f of files) {
      const rel = relative(dir, join(serverDir, f)).split("\\").join("/");
      if (!nft.files.includes(rel)) {
        nft.files.push(rel);
        changed = true;
        registered++;
      }
    }
    if (changed) await writeFile(nftPath, JSON.stringify(nft));
  }
  console.log(
    `[copy-prisma-engine] copied ${files.length} files to .next/server and registered in ${nfts.length} traces (${registered} entries)`,
  );
}

main().catch((e) => {
  console.error("[copy-prisma-engine] failed:", e);
  process.exit(1);
});