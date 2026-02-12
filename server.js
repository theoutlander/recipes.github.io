import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { YoutubeTranscript } from "youtube-transcript";
import { buildRecipeSummary, buildStaticSite, normalizeRecipeForPublish } from "./static-site.js";

const PORT = Number(process.env.PORT || 3030);
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || "*");
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 14000;
const ADMIN_KEY = String(process.env.ADMIN_KEY || "dev-admin-key");
const SITE_URL = String(process.env.SITE_URL || "");
const CONTENT_RECIPES_DIR = path.join(process.cwd(), "content", "recipes");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
ensureDir(CONTENT_RECIPES_DIR);
buildStaticSite({ siteUrl: SITE_URL });

app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (CORS_ORIGIN === "*") {
    res.header("Access-Control-Allow-Origin", "*");
  } else if (origin && origin === CORS_ORIGIN) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  }
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-key");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});
app.use(express.static(__dirname));

app.post("/api/retailers/cart-links", (req, res) => {
  try {
    const payload = Array.isArray(req.body?.ingredients) ? req.body.ingredients : [];
    const ingredients = payload
      .map((item) => normalizeIngredientName(item?.name))
      .filter(Boolean)
      .slice(0, 40);

    if (ingredients.length === 0) {
      res.status(400).json({ ok: false, error: "At least one ingredient is required." });
      return;
    }

    const providers = buildRetailerProviders(ingredients);
    res.json({
      ok: true,
      providers,
      note:
        "Direct retailer checkout requires partner credentials. These links prefill high-quality cart searches by provider.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Retailer integration failed.";
    res.status(400).json({ ok: false, error: message });
  }
});

app.post("/api/admin/publish", requireAdmin, (req, res) => {
  try {
    const recipe = req.body?.recipe;
    if (!recipe || typeof recipe !== "object") {
      res.status(400).json({ ok: false, error: "Recipe payload is required." });
      return;
    }

    const normalized = normalizeRecipeForPublish(recipe);
    ensureDir(CONTENT_RECIPES_DIR);
    const filePath = path.join(CONTENT_RECIPES_DIR, `${normalized.meta.slug}.json`);
    fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2));

    const result = buildStaticSite({ siteUrl: SITE_URL });
    const summary = buildRecipeSummary(normalized);

    res.json({
      ok: true,
      recipe: normalized,
      summary,
      publicUrl: summary.url,
      totalPublished: result.count,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publish failed.";
    res.status(500).json({ ok: false, error: message });
  }
});

app.post("/api/admin/rebuild", requireAdmin, (req, res) => {
  try {
    const result = buildStaticSite({ siteUrl: SITE_URL });
    res.json({ ok: true, totalPublished: result.count });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rebuild failed.";
    res.status(500).json({ ok: false, error: message });
  }
});

app.post("/api/extract", async (req, res) => {
  const url = sanitizeUrl(req.body?.url);
  if (!url) {
    res.status(400).json({ ok: false, error: "Provide a valid URL." });
    return;
  }

  try {
    const detectedType = detectSourceType(url);
    const extraction = detectedType === "youtube" ? await extractFromYouTube(url) : await extractFromWeb(url);

    const responseBody = {
      ok: true,
      detectedType: extraction.detectedType || detectedType,
      extracted: {
        title: extraction.title || "",
        author: extraction.author || "",
        imageUrl: extraction.imageUrl || "",
        ingredients: extraction.ingredients || [],
        steps: extraction.steps || [],
        creditNotes: extraction.creditNotes || "",
      },
      discovery: {
        method: extraction.method || "unknown",
        detectedType: extraction.detectedType || detectedType,
        transcriptAvailable: Boolean(extraction.transcriptAvailable),
        recipeLinks: extraction.recipeLinks || [],
        notes: extraction.notes || [],
      },
    };

    res.json(responseBody);
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Extraction failed.",
    });
  }
});

app.listen(PORT, () => {
  process.stdout.write(`MiseFlow running at http://localhost:${PORT}\n`);
});

function requireAdmin(req, res, next) {
  const headerKey = String(req.headers["x-admin-key"] || "").trim();
  const bodyKey = String(req.body?.adminKey || "").trim();
  const key = headerKey || bodyKey;
  if (!key || key !== ADMIN_KEY) {
    res.status(401).json({ ok: false, error: "Invalid admin key." });
    return;
  }
  next();
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function normalizeIngredientName(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9\s\-']/g, "")
    .trim()
    .slice(0, 80);
}

function buildRetailerProviders(ingredients) {
  const compactQuery = ingredients.slice(0, 12).join(", ");
  const providers = [
    {
      id: "instacart",
      label: "Instacart",
      cartUrl: `https://www.instacart.com/store/s?k=${encodeURIComponent(compactQuery)}`,
    },
    {
      id: "walmart",
      label: "Walmart",
      cartUrl: `https://www.walmart.com/search?q=${encodeURIComponent(compactQuery)}`,
    },
    {
      id: "amazon",
      label: "Amazon",
      cartUrl: `https://www.amazon.com/s?k=${encodeURIComponent(compactQuery)}&i=grocery`,
    },
  ];

  return providers.map((provider) => ({
    ...provider,
    items: ingredients.map((name) => ({
      name,
      url: buildRetailerItemUrl(provider.id, name),
    })),
  }));
}

function buildRetailerItemUrl(providerId, ingredientName) {
  const query = encodeURIComponent(ingredientName);
  if (providerId === "instacart") {
    return `https://www.instacart.com/store/s?k=${query}`;
  }
  if (providerId === "walmart") {
    return `https://www.walmart.com/search?q=${query}`;
  }
  return `https://www.amazon.com/s?k=${query}&i=grocery`;
}

function sanitizeUrl(value) {
  if (typeof value !== "string") {
    return "";
  }
  try {
    const parsed = new URL(value.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function detectSourceType(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) {
      return "youtube";
    }
  } catch {
    return "web";
  }
  return "web";
}

async function extractFromWeb(url) {
  const html = await fetchText(url);
  const parsed = parseRecipeFromHtml(html, url);
  const hostname = safeHostname(url);
  const notes = [];

  if (parsed.ingredients.length === 0) {
    notes.push("No clear ingredient section detected.");
  }
  if (parsed.steps.length === 0) {
    notes.push("No clear instruction section detected.");
  }
  if (parsed.usedJsonLd) {
    notes.push("Recipe schema (JSON-LD) was used.");
  } else {
    notes.push("Used heading and list heuristics.");
  }

  const author = parsed.author || "";
  const creditNotes = author
    ? `Adapted from ${author}. Keep attribution when republishing.`
    : `Adapted from ${hostname}. Keep attribution to the original creator.`;

  return {
    detectedType: "web",
    method: parsed.usedJsonLd ? "jsonld-recipe" : "html-heuristics",
    title: parsed.title,
    author: parsed.author,
    imageUrl: parsed.imageUrl,
    ingredients: parsed.ingredients,
    steps: parsed.steps,
    recipeLinks: [url],
    transcriptAvailable: false,
    notes,
    creditNotes,
  };
}

function parseRecipeFromHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  const linkedData = extractRecipeFromJsonLd($);

  let title = linkedData.title || readMetaValue($, "property", "og:title") || readMetaValue($, "name", "twitter:title");
  let author = linkedData.author || readMetaValue($, "name", "author");
  let imageUrl =
    linkedData.imageUrl || readMetaValue($, "property", "og:image") || readMetaValue($, "name", "twitter:image");

  if (!title) {
    title = $("h1").first().text().trim() || $("title").first().text().trim();
  }

  if (!author) {
    author = $("[itemprop='author']").first().text().trim();
  }

  if (!imageUrl) {
    imageUrl = $("img").first().attr("src") || "";
  }

  let ingredients = linkedData.ingredients;
  let steps = linkedData.steps;

  if (ingredients.length === 0) {
    ingredients = extractSectionByHeading($, ["ingredients"]);
    if (ingredients.length === 0) {
      ingredients = $("[itemprop='recipeIngredient']")
        .toArray()
        .map((node) => $(node).text().trim());
    }
  }

  if (steps.length === 0) {
    steps = extractSectionByHeading($, ["instructions", "directions", "method", "preparation"]);
    if (steps.length === 0) {
      steps = $("[itemprop='recipeInstructions']")
        .toArray()
        .map((node) => $(node).text().trim());
    }
  }

  ingredients = cleanLines(ingredients, 80);
  steps = cleanLines(
    steps.map((line) => line.replace(/^\d+[\.\)\-\s]*/, "")),
    80
  );

  if (title) {
    title = decodeHtml(title);
  }
  if (author) {
    author = decodeHtml(author);
  }
  if (imageUrl) {
    imageUrl = absolutizeUrl(imageUrl, baseUrl);
  }

  return {
    title,
    author,
    imageUrl,
    ingredients,
    steps,
    usedJsonLd: linkedData.usedJsonLd,
  };
}

function extractRecipeFromJsonLd($) {
  const recipeNodes = [];
  $("script[type='application/ld+json']").each((_, element) => {
    const raw = $(element).contents().text().trim();
    if (!raw) {
      return;
    }
    const parsed = safeJsonParse(raw);
    if (!parsed) {
      return;
    }
    collectRecipeNodes(parsed, recipeNodes);
  });

  if (recipeNodes.length === 0) {
    return {
      title: "",
      author: "",
      imageUrl: "",
      ingredients: [],
      steps: [],
      usedJsonLd: false,
    };
  }

  const recipe = recipeNodes[0];
  const title = readText(recipe.name);
  const author = readAuthor(recipe.author);
  const imageUrl = readImage(recipe.image);
  const ingredients = normalizeLinkedDataIngredients(recipe.recipeIngredient);
  const steps = normalizeLinkedDataInstructions(recipe.recipeInstructions);

  return {
    title,
    author,
    imageUrl,
    ingredients,
    steps,
    usedJsonLd: true,
  };
}

function collectRecipeNodes(node, output) {
  if (!node) {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectRecipeNodes(item, output);
    }
    return;
  }
  if (typeof node !== "object") {
    return;
  }

  const type = normalizeType(node["@type"]);
  if (type.includes("recipe")) {
    output.push(node);
  }

  if (node["@graph"]) {
    collectRecipeNodes(node["@graph"], output);
  }

  for (const key of Object.keys(node)) {
    if (key === "@graph") {
      continue;
    }
    const value = node[key];
    if (value && typeof value === "object") {
      collectRecipeNodes(value, output);
    }
  }
}

function normalizeType(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item).toLowerCase());
  }
  return [String(value).toLowerCase()];
}

function normalizeLinkedDataIngredients(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((item) => readText(item));
  }
  if (typeof value === "string") {
    return value.split(/\r?\n/);
  }
  return [];
}

function normalizeLinkedDataInstructions(value) {
  if (!value) {
    return [];
  }
  if (typeof value === "string") {
    return value.split(/\r?\n/);
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const lines = [];
  for (const item of value) {
    if (!item) {
      continue;
    }
    if (typeof item === "string") {
      lines.push(item);
      continue;
    }
    if (typeof item === "object") {
      if (item.text) {
        lines.push(readText(item.text));
      }
      if (Array.isArray(item.itemListElement)) {
        for (const nested of item.itemListElement) {
          if (typeof nested === "string") {
            lines.push(nested);
          } else if (nested?.text) {
            lines.push(readText(nested.text));
          }
        }
      }
    }
  }
  return lines;
}

function readAuthor(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return decodeHtml(value.trim());
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = readAuthor(item);
      if (parsed) {
        return parsed;
      }
    }
    return "";
  }
  if (typeof value === "object") {
    if (typeof value.name === "string") {
      return decodeHtml(value.name.trim());
    }
  }
  return "";
}

function readImage(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return readImage(value[0]);
  }
  if (typeof value === "object") {
    if (typeof value.url === "string") {
      return value.url;
    }
  }
  return "";
}

function readText(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return decodeHtml(value.trim());
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "object" && typeof value.text === "string") {
    return decodeHtml(value.text.trim());
  }
  return "";
}

function extractSectionByHeading($, keywords) {
  const headingSelector = "h1, h2, h3, h4, h5, h6";
  const headings = $(headingSelector).toArray();

  for (const heading of headings) {
    const headingText = $(heading).text().trim().toLowerCase();
    if (!keywords.some((keyword) => headingText.includes(keyword))) {
      continue;
    }

    const lines = [];
    const section = $(heading).nextUntil(headingSelector);
    section.each((_, element) => {
      const tagName = (element.tagName || "").toLowerCase();
      if (tagName === "ul" || tagName === "ol") {
        $(element)
          .find("li")
          .each((__, item) => lines.push($(item).text().trim()));
      } else {
        const text = $(element).text().trim();
        if (text) {
          lines.push(...text.split(/\r?\n/).map((line) => line.trim()));
        }
      }
    });

    const cleaned = cleanLines(lines, 80);
    if (cleaned.length > 0) {
      return cleaned;
    }
  }

  return [];
}

async function extractFromYouTube(url) {
  const videoId = parseYouTubeVideoId(url);
  if (!videoId) {
    throw new Error("Could not find a YouTube video id in that URL.");
  }
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const [oEmbedResult, pageResult, transcriptResult] = await Promise.allSettled([
    fetchYouTubeOEmbed(watchUrl),
    fetchText(watchUrl),
    fetchTranscript(videoId),
  ]);

  const oEmbed = oEmbedResult.status === "fulfilled" ? oEmbedResult.value : null;
  const pageHtml = pageResult.status === "fulfilled" ? pageResult.value : "";
  const transcript = transcriptResult.status === "fulfilled" ? transcriptResult.value : [];

  const description = parseYouTubeDescription(pageHtml);
  const links = dedupeStrings(extractUrls(description));
  const recipeCandidates = links.filter(isLikelyRecipeLink).slice(0, 5);
  const notes = [];
  let linkedRecipe = null;

  for (const link of recipeCandidates) {
    if (detectSourceType(link) === "youtube") {
      continue;
    }

    try {
      const candidate = await extractFromWeb(link);
      if (candidate.ingredients.length > 0 || candidate.steps.length > 0) {
        linkedRecipe = candidate;
        notes.push(`Extracted recipe details from linked URL: ${link}`);
        break;
      }
    } catch {
      notes.push(`Linked URL could not be parsed: ${link}`);
    }
  }

  let ingredients = linkedRecipe?.ingredients || extractIngredientLikeLines(description);
  let steps = linkedRecipe?.steps || extractInstructionLikeLines(description);

  if (steps.length === 0 && transcript.length > 0) {
    steps = transcriptToSteps(transcript);
    if (steps.length > 0) {
      notes.push("Generated steps from YouTube transcript.");
    }
  }

  if (ingredients.length === 0 && transcript.length > 0) {
    ingredients = transcriptToIngredients(transcript);
    if (ingredients.length > 0) {
      notes.push("Generated ingredient hints from transcript.");
    }
  }

  ingredients = cleanLines(ingredients, 80);
  steps = cleanLines(steps, 80);

  const title = linkedRecipe?.title || oEmbed?.title || parseTitleFromHtml(pageHtml) || "YouTube Recipe";
  const author = linkedRecipe?.author || oEmbed?.author_name || "";
  const imageUrl = linkedRecipe?.imageUrl || oEmbed?.thumbnail_url || "";
  const recipeLinks = dedupeStrings([watchUrl, ...recipeCandidates]);
  const transcriptAvailable = transcript.length > 0;

  if (recipeCandidates.length === 0) {
    notes.push("No recipe links detected in video description.");
  } else if (!linkedRecipe) {
    notes.push("Recipe links were found, but no parsable recipe card was detected.");
  }
  if (!transcriptAvailable) {
    notes.push("Transcript unavailable for this video.");
  }

  const method = linkedRecipe
    ? "youtube-linked-recipe"
    : transcriptAvailable
      ? "youtube-transcript-heuristics"
      : "youtube-description-heuristics";
  const creditNotes = author
    ? `Adapted from YouTube creator ${author}. Keep original creator credit.`
    : "Adapted from a YouTube source. Keep original creator credit.";

  return {
    detectedType: "youtube",
    method,
    title,
    author,
    imageUrl,
    ingredients,
    steps,
    recipeLinks,
    transcriptAvailable,
    notes,
    creditNotes,
  };
}

function parseYouTubeVideoId(input) {
  try {
    const url = new URL(input);
    if (url.hostname.includes("youtu.be")) {
      return url.pathname.split("/").filter(Boolean)[0] || "";
    }
    if (url.searchParams.has("v")) {
      return url.searchParams.get("v") || "";
    }
    const segments = url.pathname.split("/").filter(Boolean);
    const embedIndex = segments.indexOf("embed");
    if (embedIndex >= 0 && segments[embedIndex + 1]) {
      return segments[embedIndex + 1];
    }
  } catch {
    return "";
  }
  return "";
}

async function fetchYouTubeOEmbed(url) {
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const data = await fetchJson(endpoint);
  return data;
}

async function fetchTranscript(videoId) {
  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    if (!Array.isArray(transcript)) {
      return [];
    }
    return transcript;
  } catch {
    return [];
  }
}

function parseYouTubeDescription(html) {
  if (!html) {
    return "";
  }

  const shortDescriptionMatch = html.match(/"shortDescription":"((?:\\.|[^"\\])*)"/);
  let decodedShortDescription = "";
  if (shortDescriptionMatch?.[1]) {
    try {
      decodedShortDescription = JSON.parse(`"${shortDescriptionMatch[1]}"`);
    } catch {
      decodedShortDescription = shortDescriptionMatch[1]
        .replaceAll("\\n", "\n")
        .replaceAll("\\u0026", "&")
        .replaceAll('\\"', '"');
    }
  }

  const $ = cheerio.load(html);
  const metaDescription = readMetaValue($, "name", "description");
  return [decodedShortDescription, metaDescription].sort((a, b) => b.length - a.length)[0] || "";
}

function parseTitleFromHtml(html) {
  if (!html) {
    return "";
  }
  const $ = cheerio.load(html);
  const title = readMetaValue($, "property", "og:title") || $("title").first().text().trim();
  return decodeHtml(title);
}

function extractUrls(text) {
  if (!text) {
    return [];
  }
  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  return matches.map((value) => value.replace(/[.,!?]$/, ""));
}

function extractIngredientLikeLines(text) {
  if (!text) {
    return [];
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const startIndex = lines.findIndex((line) => /\bingredients?\b/i.test(line));
  if (startIndex >= 0) {
    const section = [];
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^\s*(instructions?|method|directions?)\b/i.test(line)) {
        break;
      }
      if (line.length < 3) {
        continue;
      }
      section.push(line.replace(/^[-*]\s*/, ""));
    }
    if (section.length > 0) {
      return section;
    }
  }

  return lines.filter((line) =>
    /^(\d+(\s+\d+\/\d+)?|\d+\/\d+|\d+\.\d+)\s+([a-zA-Z]+)\b/.test(line.replace(/^[-*]\s*/, ""))
  );
}

function extractInstructionLikeLines(text) {
  if (!text) {
    return [];
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const startIndex = lines.findIndex((line) => /\b(instructions?|directions?|method)\b/i.test(line));
  if (startIndex >= 0) {
    const section = [];
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^\s*(notes?|nutrition|serving)\b/i.test(line)) {
        break;
      }
      if (line.length < 8) {
        continue;
      }
      section.push(line.replace(/^\d+[\.\)\-\s]*/, ""));
    }
    if (section.length > 0) {
      return section;
    }
  }

  return lines
    .filter((line) => /^\d+[\.\)\-\s]/.test(line))
    .map((line) => line.replace(/^\d+[\.\)\-\s]*/, ""));
}

function transcriptToSteps(transcriptItems) {
  const transcriptText = transcriptItems.map((item) => item?.text || "").join(" ");
  const sentences = transcriptText
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = sentences.filter((line) =>
    /\b(add|mix|stir|cook|bake|heat|whisk|simmer|season|serve|chop|slice|boil|pour|combine|saute)\b/i.test(line)
  );

  return dedupeStrings(candidates).slice(0, 18);
}

function transcriptToIngredients(transcriptItems) {
  const transcriptText = transcriptItems.map((item) => item?.text || "").join(" ");
  const matches =
    transcriptText.match(
      /(\d+(\s+\d+\/\d+)?|\d+\/\d+|\d+\.\d+)\s+(cups?|cup|tbsp|tablespoons?|tsp|teaspoons?|lb|lbs|oz|ounces?|grams?|g|ml|cloves?)\s+([a-zA-Z][a-zA-Z\s-]{2,40})/gi
    ) || [];

  if (matches.length > 0) {
    return dedupeStrings(matches).slice(0, 30);
  }

  const ingredientHints = [
    "salt",
    "pepper",
    "garlic",
    "onion",
    "olive oil",
    "butter",
    "chicken",
    "beef",
    "pasta",
    "rice",
    "tomato",
    "lemon",
  ];
  const normalizedText = transcriptText.toLowerCase();
  const hints = ingredientHints
    .filter((hint) => normalizedText.includes(hint))
    .map((hint) => `${hint} (quantity not specified)`);

  return hints.slice(0, 20);
}

function isLikelyRecipeLink(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtube.com") || parsed.hostname.includes("youtu.be")) {
      return false;
    }
    const value = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
    return /(recipe|recipes|cooking|kitchen|food|meal|dish|allrecipes|foodnetwork|seriouseats|epicurious|bonappetit)/.test(
      value
    );
  } catch {
    return false;
  }
}

function cleanLines(lines, limit = 60) {
  const seen = new Set();
  const cleaned = [];
  for (const raw of lines || []) {
    if (typeof raw !== "string") {
      continue;
    }
    const line = sanitizeLine(raw);
    if (!line) {
      continue;
    }
    const key = line.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    cleaned.push(line);
    if (cleaned.length >= limit) {
      break;
    }
  }
  return cleaned;
}

function sanitizeLine(value) {
  return decodeHtml(value)
    .replace(/\s+/g, " ")
    .replace(/^[\-\*\u2022]\s*/, "")
    .replace(/^\d+\)\s*/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/^\d+\-\s+/, "")
    .trim();
}

function readMetaValue($, attr, key) {
  return $(`meta[${attr}='${key}']`).attr("content")?.trim() || "";
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const sanitized = raw
      .trim()
      .replace(/^\uFEFF/, "")
      .replace(/[\u0000-\u001F]+/g, " ");
    try {
      return JSON.parse(sanitized);
    } catch {
      return null;
    }
  }
}

function decodeHtml(value) {
  if (!value) {
    return "";
  }
  return cheerio.load("<div></div>")("div").html(value).text().trim();
}

function absolutizeUrl(value, base) {
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "source";
  }
}

function dedupeStrings(values) {
  const seen = new Set();
  const output = [];
  for (const value of values || []) {
    if (!value) {
      continue;
    }
    const cleaned = value.trim();
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    output.push(cleaned);
  }
  return output;
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.text();
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json,*/*" },
  });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}
