import fs from "node:fs";
import path from "node:path";

const DEFAULT_OUT = "content/source-urls.txt";
const DEFAULT_CSV_URL = process.env.URL_INBOX_CSV_URL || "";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const csvUrl = String(args.csv || DEFAULT_CSV_URL).trim();
  const outFile = path.resolve(process.cwd(), args.out || DEFAULT_OUT);

  if (!csvUrl) {
    throw new Error("Missing CSV URL. Pass --csv or set URL_INBOX_CSV_URL.");
  }

  const response = await fetch(csvUrl, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Failed to fetch CSV (${response.status}).`);
  }
  const csvText = await response.text();

  const urls = extractUrls(csvText);
  const content = [
    "# Auto-generated from URL inbox feed",
    `# Generated: ${new Date().toISOString()}`,
    ...urls,
    "",
  ].join("\n");

  ensureDir(path.dirname(outFile));
  fs.writeFileSync(outFile, content);
  process.stdout.write(`Wrote ${urls.length} URL(s) to ${outFile}\n`);
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--csv") {
      parsed.csv = args[index + 1];
      index += 1;
    } else if (arg === "--out") {
      parsed.out = args[index + 1];
      index += 1;
    }
  }
  return parsed;
}

function extractUrls(text) {
  const matches = text.match(/https?:\/\/[^\s"',)]+/gi) || [];
  const seen = new Set();
  const urls = [];
  for (const raw of matches) {
    const cleaned = raw.trim().replace(/[.,!?;:]$/, "");
    if (!cleaned) {
      continue;
    }
    if (seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    urls.push(cleaned);
  }
  return urls;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
