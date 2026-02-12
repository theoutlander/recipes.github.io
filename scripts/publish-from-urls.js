import fs from "node:fs";
import path from "node:path";

const DEFAULT_API_BASE = process.env.API_BASE_URL || "http://localhost:3030";
const DEFAULT_FILE = "content/source-urls.txt";
const ADMIN_KEY = process.env.ADMIN_KEY || "dev-admin-key";

const UNIT_PATTERN =
  "(cups?|cup|tbsp|tablespoons?|tsp|teaspoons?|pounds?|lbs?|lb|ounces?|oz|grams?|g|kilograms?|kg|ml|l|cloves?|clove|cans?|can|packages?|package|pkg|pinch|dash|slices?|slice)";
const PREP_PATTERN =
  /\b(minced|chopped|diced|sliced|julienned|peeled|grated|rinsed|drained|melted|softened|beaten|whisked|crushed)\b/i;

const CATEGORY_RULES = [
  { name: "Produce", words: ["onion", "garlic", "tomato", "pepper", "lemon", "lime", "herb", "cilantro", "parsley", "spinach", "carrot", "celery", "potato", "scallion", "ginger", "mushroom"] },
  { name: "Protein", words: ["chicken", "beef", "pork", "fish", "shrimp", "tofu", "egg", "turkey", "salmon", "lamb", "sausage"] },
  { name: "Dairy", words: ["milk", "cream", "yogurt", "butter", "cheese", "parmesan", "mozzarella", "feta"] },
  { name: "Spice", words: ["pepper", "paprika", "cumin", "turmeric", "coriander", "cinnamon", "oregano", "thyme", "rosemary", "chili", "flake", "powder"] },
  { name: "Pantry", words: ["oil", "vinegar", "soy", "pasta", "rice", "bean", "flour", "sugar", "salt", "stock", "broth", "mustard", "honey", "sauce"] },
];

const SOURCE_LABELS = {
  web: "Web Article",
  youtube: "YouTube Video",
  manual: "Original Recipe",
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(process.cwd(), args.file || DEFAULT_FILE);
  const apiBase = String(args.api || DEFAULT_API_BASE).replace(/\/+$/, "");
  const servings = Number(args.servings || 4);
  const limit = Number(args.limit || 50);
  const republish = Boolean(args.republish);
  const adminKey = String(args.key || ADMIN_KEY).trim();

  if (!fs.existsSync(filePath)) {
    throw new Error(`URL list file not found: ${filePath}`);
  }
  if (!adminKey) {
    throw new Error("Missing admin key. Set ADMIN_KEY env or pass --key.");
  }

  const urls = dedupe(readUrls(filePath));
  const existingSourceUrls = loadExistingSourceUrls(path.join(process.cwd(), "content", "recipes"));
  const publishQueue = [];
  for (const url of urls) {
    if (!republish && existingSourceUrls.has(normalizeUrlKey(url))) {
      continue;
    }
    publishQueue.push(url);
    if (publishQueue.length >= limit) {
      break;
    }
  }

  if (publishQueue.length === 0) {
    process.stdout.write("No new URLs to publish.\n");
    return;
  }

  process.stdout.write(`Publishing ${publishQueue.length} URL(s) via ${apiBase}\n`);
  const results = [];

  for (const url of publishQueue) {
    try {
      process.stdout.write(`- Extracting: ${url}\n`);
      const extracted = await apiRequest(`${apiBase}/api/extract`, {
        method: "POST",
        body: JSON.stringify({ url }),
      });

      const recipe = normalizeForPublish(extracted, url, servings);
      if (recipe.ingredients.length === 0 || recipe.steps.length === 0) {
        results.push({ url, status: "skipped", reason: "No full ingredient/step extraction." });
        process.stdout.write("  skipped (missing ingredients or steps)\n");
        continue;
      }

      const published = await apiRequest(`${apiBase}/api/admin/publish`, {
        method: "POST",
        headers: { "x-admin-key": adminKey },
        body: JSON.stringify({ recipe }),
      });
      results.push({ url, status: "published", slug: published.recipe?.meta?.slug || "", publicUrl: published.publicUrl });
      process.stdout.write(`  published -> ${published.publicUrl}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      results.push({ url, status: "failed", reason: message });
      process.stdout.write(`  failed: ${message}\n`);
    }
  }

  try {
    await apiRequest(`${apiBase}/api/admin/rebuild`, {
      method: "POST",
      headers: { "x-admin-key": adminKey },
      body: JSON.stringify({}),
    });
  } catch (error) {
    process.stdout.write(`Rebuild warning: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  const publishedCount = results.filter((item) => item.status === "published").length;
  const skippedCount = results.filter((item) => item.status === "skipped").length;
  const failedCount = results.filter((item) => item.status === "failed").length;
  process.stdout.write(
    `Done. Published: ${publishedCount}, Skipped: ${skippedCount}, Failed: ${failedCount}\n`
  );
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--file") {
      parsed.file = args[index + 1];
      index += 1;
    } else if (arg === "--api") {
      parsed.api = args[index + 1];
      index += 1;
    } else if (arg === "--key") {
      parsed.key = args[index + 1];
      index += 1;
    } else if (arg === "--servings") {
      parsed.servings = args[index + 1];
      index += 1;
    } else if (arg === "--limit") {
      parsed.limit = args[index + 1];
      index += 1;
    } else if (arg === "--republish") {
      parsed.republish = true;
    }
  }
  return parsed;
}

function readUrls(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function loadExistingSourceUrls(directoryPath) {
  const output = new Set();
  if (!fs.existsSync(directoryPath)) {
    return output;
  }
  const files = fs.readdirSync(directoryPath).filter((file) => file.endsWith(".json"));
  for (const file of files) {
    const absolute = path.join(directoryPath, file);
    try {
      const raw = fs.readFileSync(absolute, "utf8");
      const recipe = JSON.parse(raw);
      const sourceUrl = String(recipe?.meta?.sourceUrl || "").trim();
      if (sourceUrl) {
        output.add(normalizeUrlKey(sourceUrl));
      }
    } catch {
      // Ignore unreadable records.
    }
  }
  return output;
}

function normalizeUrlKey(value) {
  return String(value || "").trim().toLowerCase();
}

async function apiRequest(url, options = {}) {
  const headers = {
    ...(options.headers || {}),
  };
  if (options.body && !("Content-Type" in headers) && !("content-type" in headers)) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(url, {
    ...options,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

function normalizeForPublish(extractedPayload, sourceUrl, servings) {
  const extracted = extractedPayload.extracted || {};
  const discovery = extractedPayload.discovery || null;
  const sourceType = extractedPayload.detectedType || "manual";
  const ingredients = parseIngredients(extracted.ingredients || []);
  const steps = parseSteps(extracted.steps || []);
  applyFirstStep(ingredients, steps);
  const bowls = buildBowlPlan(ingredients);
  const mise = buildMiseTasks(ingredients, bowls);

  const meta = {
    title: (extracted.title || "Untitled Recipe").trim(),
    author: (extracted.author || "").trim(),
    sourceType,
    sourceUrl,
    servings: Number.isFinite(servings) && servings > 0 ? servings : 4,
    imageUrl: (extracted.imageUrl || "").trim(),
    creditNotes: (extracted.creditNotes || "").trim(),
    normalizedAt: new Date().toISOString(),
  };

  const citation = {
    sourceType: SOURCE_LABELS[sourceType] || SOURCE_LABELS.manual,
    sourceUrl,
    author: meta.author,
    capturedOn: new Date().toLocaleDateString(),
    creditLine:
      meta.creditNotes ||
      (meta.author
        ? `Adapted from ${meta.author}. Keep attribution when republishing.`
        : "Original source credit should be preserved when republishing."),
    extractionMethod: discovery?.method || "batch-local",
    references: dedupe([sourceUrl, ...(discovery?.recipeLinks || [])]),
  };

  return {
    meta,
    ingredients,
    steps,
    bowls,
    separate: [],
    mise,
    shopping: buildShoppingList(ingredients),
    citation,
    discovery,
    checkState: { mise: {}, steps: {}, shopping: {} },
  };
}

function parseIngredients(lines) {
  return lines.map((line, index) => parseIngredientLine(String(line || "").trim(), index)).filter(Boolean);
}

function parseIngredientLine(line, index) {
  if (!line) {
    return null;
  }
  const cleaned = line.replace(/\s+/g, " ").trim();
  const regex = new RegExp(
    "^\\s*(?:(\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d*\\.?\\d+)\\s+)?(?:" + UNIT_PATTERN + "\\.?\\s+)?(.+)$",
    "i"
  );
  const match = cleaned.match(regex);

  let quantity = "";
  let unit = "";
  let core = cleaned;

  if (match) {
    quantity = (match[1] || "").trim();
    const maybeUnit = cleaned
      .slice((match[1] || "").length)
      .trim()
      .match(new RegExp("^" + UNIT_PATTERN + "\\.?", "i"));
    if (maybeUnit) {
      unit = maybeUnit[0].replace(/\.$/, "");
    }
    core = (match[2] || cleaned).trim();
  }

  const commaSplit = core.split(",");
  const name = (commaSplit.shift() || "").trim();
  let prep = commaSplit.join(",").trim();
  if (!prep && PREP_PATTERN.test(core)) {
    const found = core.match(PREP_PATTERN);
    if (found) {
      prep = found[1].toLowerCase();
    }
  }

  return {
    id: `ing-${index}`,
    raw: cleaned,
    quantity,
    unit,
    name: name || cleaned,
    prep,
    firstStep: 0,
    bowl: "",
    category: inferCategory(name || cleaned),
  };
}

function parseSteps(lines) {
  return lines
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\d+[\.\)\-\s]*/, ""));
}

function applyFirstStep(ingredients, steps) {
  const stepLines = steps.map((step) => step.toLowerCase());
  for (const ingredient of ingredients) {
    const key = ingredient.name.toLowerCase();
    let first = 0;
    for (let index = 0; index < stepLines.length; index += 1) {
      if (stepLines[index].includes(key)) {
        first = index;
        break;
      }
    }
    ingredient.firstStep = first;
  }
}

function buildBowlPlan(ingredients) {
  const grouped = new Map();
  for (const ingredient of ingredients) {
    const step = ingredient.firstStep;
    if (!grouped.has(step)) {
      grouped.set(step, []);
    }
    grouped.get(step).push(ingredient.name);
  }

  let count = 1;
  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([step, names]) => ({
      name: `Bowl ${count++}`,
      step: step + 1,
      ingredients: names,
    }));
}

function buildMiseTasks(ingredients, bowls) {
  const tasks = [];
  for (const ingredient of ingredients) {
    if (ingredient.prep) {
      tasks.push(`${capitalize(ingredient.prep)} ${ingredient.name}`);
    }
  }
  for (const bowl of bowls) {
    tasks.push(`Stage ${bowl.name}: ${bowl.ingredients.join(", ")} before Step ${bowl.step}`);
  }
  if (tasks.length === 0) {
    tasks.push("Gather all ingredients and cooking tools.");
  }
  return dedupe(tasks);
}

function buildShoppingList(ingredients) {
  const byCategory = {};
  for (const ingredient of ingredients) {
    if (!byCategory[ingredient.category]) {
      byCategory[ingredient.category] = [];
    }
    byCategory[ingredient.category].push({
      name: ingredient.name,
      unit: ingredient.unit,
      quantityText: ingredient.quantity,
    });
  }
  return byCategory;
}

function inferCategory(name) {
  const normalized = String(name || "").toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.words.some((word) => normalized.includes(word))) {
      return rule.name;
    }
  }
  return "Other";
}

function dedupe(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text.toLowerCase())) {
      continue;
    }
    seen.add(text.toLowerCase());
    output.push(text);
  }
  return output;
}

function capitalize(value) {
  const text = String(value || "");
  if (!text) {
    return "";
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
