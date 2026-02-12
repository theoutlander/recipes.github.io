import fs from "node:fs";
import path from "node:path";

const SOURCE_LABELS = {
  web: "Web Article",
  youtube: "YouTube Video",
  manual: "Original Recipe",
};

const ROOT_DIR = process.cwd();
const CONTENT_DIR = path.join(ROOT_DIR, "content", "recipes");
const RECIPES_DIR = path.join(ROOT_DIR, "recipes");

export function buildStaticSite(options = {}) {
  const siteUrl = String(options.siteUrl || "").replace(/\/+$/, "");
  ensureDir(CONTENT_DIR);
  ensureDir(RECIPES_DIR);

  const recipeFiles = fs
    .readdirSync(CONTENT_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort();

  const recipes = [];
  for (const file of recipeFiles) {
    const absolutePath = path.join(CONTENT_DIR, file);
    const recipe = safeReadRecipe(absolutePath);
    if (!recipe) {
      continue;
    }
    const normalized = normalizeRecipeForPublish(recipe);
    recipes.push(normalized);
    fs.writeFileSync(absolutePath, JSON.stringify(normalized, null, 2));
  }

  recipes.sort(
    (a, b) =>
      new Date(b.meta.publishedAt || b.meta.updatedAt || b.meta.normalizedAt || 0).getTime() -
      new Date(a.meta.publishedAt || a.meta.updatedAt || a.meta.normalizedAt || 0).getTime()
  );

  for (const recipe of recipes) {
    const filePath = path.join(RECIPES_DIR, `${recipe.meta.slug}.html`);
    fs.writeFileSync(filePath, buildRecipeHtml(recipe, siteUrl));
  }

  const summary = recipes.map((recipe) => buildRecipeSummary(recipe));
  fs.writeFileSync(
    path.join(RECIPES_DIR, "index.json"),
    JSON.stringify({ updatedAt: new Date().toISOString(), recipes: summary }, null, 2)
  );
  fs.writeFileSync(path.join(ROOT_DIR, "sitemap.xml"), buildSitemap(summary, siteUrl));
  return { count: recipes.length };
}

export function normalizeRecipeForPublish(recipe) {
  const cloned = JSON.parse(JSON.stringify(recipe || {}));
  const meta = cloned.meta && typeof cloned.meta === "object" ? cloned.meta : {};
  const title = String(meta.title || "Untitled Recipe").trim();
  const slug = slugify(meta.slug || title);
  const now = new Date().toISOString();

  meta.title = title;
  meta.slug = slug;
  meta.sourceType = meta.sourceType || "manual";
  meta.normalizedAt = meta.normalizedAt || now;
  meta.updatedAt = now;
  meta.publishedAt = meta.publishedAt || now;
  meta.servings = Number(meta.servings || 1);
  cloned.meta = meta;

  cloned.ingredients = Array.isArray(cloned.ingredients) ? cloned.ingredients : [];
  cloned.steps = Array.isArray(cloned.steps) ? cloned.steps : [];
  cloned.mise = Array.isArray(cloned.mise) ? cloned.mise : [];
  cloned.bowls = Array.isArray(cloned.bowls) ? cloned.bowls : [];
  cloned.separate = Array.isArray(cloned.separate) ? cloned.separate : [];
  cloned.shopping = cloned.shopping && typeof cloned.shopping === "object" ? cloned.shopping : {};
  cloned.citation = cloned.citation && typeof cloned.citation === "object" ? cloned.citation : {};
  return cloned;
}

export function buildRecipeSummary(recipe) {
  const description = buildDescription(recipe);
  return {
    slug: recipe.meta.slug,
    title: recipe.meta.title,
    author: recipe.meta.author || recipe.citation?.author || "",
    imageUrl: recipe.meta.imageUrl || "",
    sourceType: recipe.meta.sourceType || "manual",
    sourceLabel: SOURCE_LABELS[recipe.meta.sourceType] || SOURCE_LABELS.manual,
    description,
    updatedAt: recipe.meta.updatedAt || recipe.meta.normalizedAt || new Date().toISOString(),
    url: `recipes/${recipe.meta.slug}.html`,
  };
}

function buildDescription(recipe) {
  if (recipe.meta.description) {
    return String(recipe.meta.description).trim().slice(0, 180);
  }
  const step = Array.isArray(recipe.steps) && recipe.steps.length > 0 ? String(recipe.steps[0]).trim() : "";
  if (step) {
    return step.slice(0, 180);
  }
  return "Normalized recipe with ingredients, prep checklist, and structured cooking steps.";
}

function buildRecipeHtml(recipe, siteUrl) {
  const title = recipe.meta.title;
  const description = buildDescription(recipe);
  const canonicalPath = `recipes/${recipe.meta.slug}.html`;
  const canonicalUrl = siteUrl ? `${siteUrl}/${canonicalPath}` : canonicalPath;
  const imageUrl = recipe.meta.imageUrl || "";
  const ingredients = recipe.ingredients.map((item) => formatIngredient(item));
  const stepItems = recipe.steps.map((step) => String(step || "").trim()).filter(Boolean);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: title,
    author: recipe.meta.author ? { "@type": "Person", name: recipe.meta.author } : undefined,
    image: imageUrl || undefined,
    description,
    recipeYield: recipe.meta.servings ? `${recipe.meta.servings} servings` : undefined,
    recipeIngredient: ingredients,
    recipeInstructions: stepItems.map((step) => ({ "@type": "HowToStep", text: step })),
    datePublished: recipe.meta.publishedAt || recipe.meta.updatedAt || recipe.meta.normalizedAt,
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)} | MiseFlow Recipes</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    ${imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}" />` : ""}
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="stylesheet" href="../site.css" />
    <link rel="stylesheet" href="../recipe.css" />
    <script type="application/ld+json">${escapeJsonLd(jsonLd)}</script>
  </head>
  <body>
    <main class="recipe-shell">
      <a class="back-link" href="../">← Back to all recipes</a>
      <header class="recipe-head">
        <p class="source-pill">${escapeHtml(SOURCE_LABELS[recipe.meta.sourceType] || SOURCE_LABELS.manual)}</p>
        <h1>${escapeHtml(title)}</h1>
        <p class="meta-line">
          ${escapeHtml(recipe.meta.author || recipe.citation?.author || "Unknown author")} • ${escapeHtml(
            recipe.meta.servings ? `${recipe.meta.servings} servings` : "Serving size not specified"
          )}
        </p>
        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" />` : ""}
      </header>

      <section class="recipe-grid">
        <article class="card">
          <h2>Ingredients</h2>
          <ul>
            ${ingredients.map((ingredient) => `<li>${escapeHtml(ingredient)}</li>`).join("")}
          </ul>
        </article>
        <article class="card">
          <h2>Mise en Place</h2>
          <ul>
            ${(recipe.mise || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </article>
      </section>

      <section class="card">
        <h2>Steps</h2>
        <ol>
          ${stepItems.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
        </ol>
      </section>

      ${
        recipe.bowls && recipe.bowls.length > 0
          ? `<section class="card">
        <h2>Bowl Plan</h2>
        <ul>
          ${recipe.bowls
            .map(
              (bowl) =>
                `<li><strong>${escapeHtml(bowl.name || "Bowl")}</strong>: ${escapeHtml(
                  Array.isArray(bowl.ingredients) ? bowl.ingredients.join(", ") : ""
                )}</li>`
            )
            .join("")}
        </ul>
      </section>`
          : ""
      }

      <section class="card credit-card">
        <h2>Credit</h2>
        <p>${escapeHtml(recipe.citation?.creditLine || "Please credit original creator when sharing.")}</p>
        ${
          recipe.citation?.references?.length
            ? `<p>Sources: ${recipe.citation.references
                .map(
                  (reference) =>
                    `<a href="${escapeHtml(reference)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
                      reference
                    )}</a>`
                )
                .join(" • ")}</p>`
            : ""
        }
      </section>
    </main>
  </body>
</html>`;
}

function buildSitemap(summary, siteUrl) {
  const urls = summary
    .map((recipe) => {
      const loc = siteUrl ? `${siteUrl}${recipe.url}` : recipe.url;
      const lastmod = formatDate(recipe.updatedAt);
      return `  <url><loc>${escapeXml(loc)}</loc><lastmod>${escapeXml(lastmod)}</lastmod></url>`;
    })
    .join("\n");

  const indexLoc = siteUrl ? `${siteUrl}/` : "/";
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${escapeXml(indexLoc)}</loc></url>
${urls}
</urlset>
`;
}

function formatIngredient(item) {
  if (!item || typeof item !== "object") {
    return String(item || "").trim();
  }
  const qty = item.quantity ? String(item.quantity).trim() : "";
  const unit = item.unit ? String(item.unit).trim() : "";
  const name = item.name ? String(item.name).trim() : String(item.raw || "").trim();
  const prep = item.prep ? String(item.prep).trim() : "";
  const base = [qty, unit, name].filter(Boolean).join(" ").trim();
  return prep ? `${base} (${prep})` : base;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `recipe-${Date.now()}`;
}

function safeReadRecipe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function formatDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeXml(value) {
  return escapeHtml(value);
}

function escapeJsonLd(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}
