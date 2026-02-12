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
  const ingredientVisualCards = recipe.ingredients.map((item, index) => buildIngredientVisualCardHtml(item, index));
  const miseItems = (recipe.mise || []).map((item) => String(item || "").trim()).filter(Boolean);
  const bowlItems = Array.isArray(recipe.bowls) ? recipe.bowls : [];
  const stepItems = recipe.steps.map((step) => String(step || "").trim()).filter(Boolean);
  const initialStepText = stepItems[0] || "No steps available.";
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
  <body data-recipe-slug="${escapeHtml(recipe.meta.slug)}">
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
        <div class="head-actions">
          <button type="button" class="action-btn" id="toggleCookMode" aria-pressed="false">Start Cook Mode</button>
          <button type="button" class="action-btn ghost" id="resetChecklist">Reset Checklist</button>
        </div>
        <div class="progress-wrap" aria-live="polite">
          <p id="progressLabel">0 of ${stepItems.length} steps complete</p>
          <div class="progress-track" id="progressTrack" role="progressbar" aria-valuemin="0" aria-valuemax="${stepItems.length}" aria-valuenow="0">
            <span id="progressBar"></span>
          </div>
        </div>
        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" />` : ""}
      </header>

      <section class="card cook-focus" id="cookFocus" ${stepItems.length === 0 ? "hidden" : ""}>
        <p class="focus-kicker">Quick Follow</p>
        <h2 id="focusStepNumber">Step 1</h2>
        <p id="focusStepText">${escapeHtml(initialStepText)}</p>
        <div class="focus-controls">
          <button type="button" class="action-btn small" id="stepPrev">Previous</button>
          <button type="button" class="action-btn small" id="stepDone">Mark Step Done</button>
          <button type="button" class="action-btn small" id="stepNext">Next</button>
        </div>
      </section>

      <section class="recipe-grid">
        <article class="card checklist-card">
          <h2>Ingredients</h2>
          <ul class="check-list">
            ${
              ingredients.length > 0
                ? ingredients
                    .map((ingredient, index) => buildChecklistItemHtml(ingredient, "ingredients", `ingredient-${index}`))
                    .join("")
                : "<li class=\"empty-line\">No ingredients found.</li>"
            }
          </ul>
          ${
            ingredients.length > 0
              ? `<div class="visual-controls">
            <button type="button" class="action-btn ghost small" id="toggleIngredientVisuals" aria-pressed="false">
              Show Ingredient Photos
            </button>
            <p>Optional visual mode for shopping and prep.</p>
          </div>
          <div class="visual-grid" id="ingredientVisualGrid" hidden>
            ${ingredientVisualCards.join("")}
          </div>`
              : ""
          }
        </article>
        <article class="card checklist-card">
          <h2>Mise en Place</h2>
          <ul class="check-list">
            ${
              miseItems.length > 0
                ? miseItems
                    .map((item, index) => buildChecklistItemHtml(item, "mise", `mise-${index}`))
                    .join("")
                : "<li class=\"empty-line\">Gather all ingredients and tools before cooking.</li>"
            }
          </ul>
        </article>
      </section>

      <section class="card steps-card">
        <h2>Steps</h2>
        <ol class="steps-list" id="stepsList">
          ${
            stepItems.length > 0
              ? stepItems.map((step, index) => buildStepItemHtml(step, index)).join("")
              : "<li class=\"empty-line\">No steps found.</li>"
          }
        </ol>
      </section>

      ${
        bowlItems.length > 0
          ? `<section class="card">
        <h2>Bowl Plan</h2>
        <ul>
          ${bowlItems
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
    <script src="../recipe-page.js" defer></script>
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

function buildChecklistItemHtml(label, group, id) {
  const text = String(label || "").trim();
  return `<li class="check-item">
    <label>
      <input type="checkbox" data-check-group="${escapeHtml(group)}" data-check-id="${escapeHtml(id)}" />
      <span>${escapeHtml(text)}</span>
    </label>
  </li>`;
}

function buildStepItemHtml(step, index) {
  const stepNumber = index + 1;
  return `<li class="step-item" id="step-${stepNumber}" data-step-index="${stepNumber}" data-step-text="${escapeHtml(
    step
  )}">
    <label class="step-check">
      <input type="checkbox" data-check-group="steps" data-check-id="step-${stepNumber}" />
      <span class="step-copy"><strong>Step ${stepNumber}:</strong> ${escapeHtml(step)}</span>
    </label>
    <button type="button" class="focus-jump" data-step-jump="${stepNumber}">Focus</button>
  </li>`;
}

function buildIngredientVisualCardHtml(item, index) {
  const label = formatIngredient(item) || `Ingredient ${index + 1}`;
  const query = ingredientVisualQuery(item, label);
  const category =
    item && typeof item === "object"
      ? String(item.category || "").trim()
      : "";
  return `<article class="visual-card" data-ingredient-query="${escapeHtml(query)}" data-ingredient-label="${escapeHtml(
    label
  )}" data-ingredient-category="${escapeHtml(category)}">
    <div class="visual-image-wrap">
      <img loading="lazy" alt="${escapeHtml(label)} ingredient image" />
    </div>
    <p>${escapeHtml(label)}</p>
  </article>`;
}

function ingredientVisualQuery(item, fallback) {
  if (item && typeof item === "object") {
    const direct = String(item.name || item.raw || "").trim();
    if (direct) {
      return direct;
    }
  }
  return String(fallback || "").trim();
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
