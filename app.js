const STORAGE_KEY = "miseflow-library-v1";
const AUTH_TOKEN_KEY = "miseflow-auth-token";

const state = {
  currentRecipe: null,
  library: [],
  importContext: null,
  authToken: "",
  currentUser: null,
  retailerPack: null,
};

const STOPWORDS = new Set([
  "and",
  "the",
  "for",
  "with",
  "into",
  "from",
  "fresh",
  "large",
  "small",
  "medium",
  "optional",
  "taste",
  "plus",
  "more",
  "divided",
  "extra",
  "about",
  "roughly",
  "finely",
  "coarsely",
  "chopped",
  "diced",
  "minced",
  "sliced",
  "to",
]);

const CATEGORY_RULES = [
  { name: "Produce", words: ["onion", "garlic", "tomato", "pepper", "lemon", "lime", "herb", "cilantro", "parsley", "spinach", "carrot", "celery", "potato", "scallion", "ginger", "mushroom"] },
  { name: "Protein", words: ["chicken", "beef", "pork", "fish", "shrimp", "tofu", "egg", "turkey", "salmon", "lamb", "sausage"] },
  { name: "Dairy", words: ["milk", "cream", "yogurt", "butter", "cheese", "parmesan", "mozzarella", "feta"] },
  { name: "Spice", words: ["pepper", "paprika", "cumin", "turmeric", "coriander", "cinnamon", "oregano", "thyme", "rosemary", "chili", "flake", "powder"] },
  { name: "Pantry", words: ["oil", "vinegar", "soy", "pasta", "rice", "bean", "flour", "sugar", "salt", "stock", "broth", "mustard", "honey", "sauce"] },
];

const SOURCE_TYPE_LABELS = {
  web: "Web Article",
  youtube: "YouTube Video",
  manual: "Original Recipe",
};

const UNIT_PATTERN =
  "(cups?|cup|tbsp|tablespoons?|tsp|teaspoons?|pounds?|lbs?|lb|ounces?|oz|grams?|g|kilograms?|kg|ml|l|cloves?|clove|cans?|can|packages?|package|pkg|pinch|dash|slices?|slice)";

const PREP_PATTERN = /\b(minced|chopped|diced|sliced|julienned|peeled|grated|rinsed|drained|melted|softened|beaten|whisked|crushed)\b/i;

const EMPTY_MARKDOWN_PLACEHOLDER = "Normalize a recipe to generate markdown export.";

const recipeForm = document.getElementById("recipeForm");
const recipeSummary = document.getElementById("recipeSummary");
const ingredientsTableBody = document.getElementById("ingredientsTableBody");
const miseList = document.getElementById("miseList");
const bowlPlan = document.getElementById("bowlPlan");
const separateItems = document.getElementById("separateItems");
const stepsChecklist = document.getElementById("stepsChecklist");
const shoppingList = document.getElementById("shoppingList");
const citationBlock = document.getElementById("citationBlock");
const sourceDiscovery = document.getElementById("sourceDiscovery");
const markdownOutput = document.getElementById("markdownOutput");
const recipeImage = document.getElementById("recipeImage");
const imageWrap = document.getElementById("imageWrap");
const libraryList = document.getElementById("libraryList");
const libraryCount = document.getElementById("libraryCount");
const librarySearch = document.getElementById("librarySearch");
const importStatus = document.getElementById("importStatus");
const importSourceButton = document.getElementById("importSource");
const authStatus = document.getElementById("authStatus");
const authNameInput = document.getElementById("authName");
const authEmailInput = document.getElementById("authEmail");
const authPasswordInput = document.getElementById("authPassword");
const loginButton = document.getElementById("loginBtn");
const registerButton = document.getElementById("registerBtn");
const logoutButton = document.getElementById("logoutBtn");
const retailerSelect = document.getElementById("retailerSelect");
const buildRetailerLinksButton = document.getElementById("buildRetailerLinks");
const retailerLinks = document.getElementById("retailerLinks");

async function init() {
  state.library = readLocalLibrary();
  renderLibrary();
  markdownOutput.value = EMPTY_MARKDOWN_PLACEHOLDER;
  retailerLinks.innerHTML = "<p class='muted'>Normalize a recipe to generate retailer cart links.</p>";
  renderAuthState();

  recipeForm.addEventListener("submit", onNormalize);
  recipeForm.addEventListener("reset", clearOutput);
  document.getElementById("loadSample").addEventListener("click", loadSample);
  importSourceButton.addEventListener("click", importFromSource);
  document.getElementById("copyMarkdown").addEventListener("click", copyMarkdown);
  document.getElementById("copyJson").addEventListener("click", copyJson);
  document.getElementById("saveRecipe").addEventListener("click", saveCurrentRecipe);
  librarySearch.addEventListener("input", () => renderLibrary(librarySearch.value));
  libraryList.addEventListener("click", onLibraryAction);
  document.body.addEventListener("change", onChecklistChange);
  loginButton.addEventListener("click", loginAccount);
  registerButton.addEventListener("click", registerAccount);
  logoutButton.addEventListener("click", logoutAccount);
  buildRetailerLinksButton.addEventListener("click", buildRetailerPackForCurrentRecipe);
  retailerSelect.addEventListener("change", () => {
    renderShopping(state.currentRecipe);
    renderRetailerPack();
  });

  await bootstrapAuth();
}

async function bootstrapAuth() {
  const token = localStorage.getItem(AUTH_TOKEN_KEY) || "";
  if (!token) {
    setAuthStatus("Using local browser storage.", "loading");
    return;
  }

  state.authToken = token;
  try {
    const data = await apiRequest("/api/auth/me");
    state.currentUser = data.user;
    setAuthStatus(`Signed in as ${data.user.email}.`, "success");
    renderAuthState();
    await syncLibraryFromAccount();
  } catch {
    clearAuthState();
    setAuthStatus("Stored session expired. Sign in again.", "error");
  }
}

function renderAuthState() {
  const isAuthed = Boolean(state.currentUser && state.authToken);
  logoutButton.disabled = !isAuthed;
  loginButton.disabled = isAuthed;
  registerButton.disabled = isAuthed;
  authNameInput.disabled = isAuthed;
  authEmailInput.disabled = isAuthed;
  authPasswordInput.disabled = isAuthed;
}

async function registerAccount() {
  const payload = readAuthForm();
  if (!payload.email || !payload.password) {
    setAuthStatus("Enter email and password to create an account.", "error");
    return;
  }

  registerButton.disabled = true;
  setAuthStatus("Creating account...", "loading");
  try {
    const data = await apiRequest("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    applyAuthSuccess(data);
    setAuthStatus(`Account created. Signed in as ${data.user.email}.`, "success");
  } catch (error) {
    setAuthStatus(error.message || "Could not create account.", "error");
  } finally {
    registerButton.disabled = false;
  }
}

async function loginAccount() {
  const payload = readAuthForm();
  if (!payload.email || !payload.password) {
    setAuthStatus("Enter email and password to login.", "error");
    return;
  }

  loginButton.disabled = true;
  setAuthStatus("Signing in...", "loading");
  try {
    const data = await apiRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    applyAuthSuccess(data);
    setAuthStatus(`Signed in as ${data.user.email}.`, "success");
  } catch (error) {
    setAuthStatus(error.message || "Login failed.", "error");
  } finally {
    loginButton.disabled = false;
  }
}

async function logoutAccount() {
  if (!state.authToken) {
    clearAuthState();
    return;
  }
  logoutButton.disabled = true;
  try {
    await apiRequest("/api/auth/logout", { method: "POST" });
  } catch {
    // Ignore token revocation errors locally.
  }
  clearAuthState();
  state.library = readLocalLibrary();
  renderLibrary(librarySearch.value);
  setAuthStatus("Logged out. Using local browser storage.", "loading");
  logoutButton.disabled = false;
}

function readAuthForm() {
  return {
    name: (authNameInput.value || "").trim(),
    email: (authEmailInput.value || "").trim(),
    password: authPasswordInput.value || "",
  };
}

async function applyAuthSuccess(data) {
  state.authToken = data.token;
  state.currentUser = data.user;
  localStorage.setItem(AUTH_TOKEN_KEY, data.token);
  authPasswordInput.value = "";
  renderAuthState();
  await syncLibraryFromAccount();
}

function clearAuthState() {
  state.authToken = "";
  state.currentUser = null;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  renderAuthState();
}

async function syncLibraryFromAccount() {
  if (!state.authToken) {
    return;
  }
  const data = await apiRequest("/api/recipes");
  state.library = Array.isArray(data.recipes) ? data.recipes : [];
  renderLibrary(librarySearch.value);
}

function setAuthStatus(message, stateType) {
  authStatus.textContent = message || "";
  authStatus.dataset.state = stateType || "";
}

async function apiRequest(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (state.authToken) {
    headers.Authorization = `Bearer ${state.authToken}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }
  return data;
}

function onNormalize(event) {
  event.preventDefault();
  const formData = new FormData(recipeForm);
  const payload = Object.fromEntries(formData.entries());
  const recipe = normalizeRecipe(payload);
  state.currentRecipe = recipe;
  renderRecipe(recipe);
}

async function importFromSource() {
  const sourceUrl = (document.getElementById("sourceUrl").value || "").trim();
  if (!sourceUrl) {
    setImportStatus("Add a source URL first.", "error");
    return;
  }

  setImportStatus("Analyzing source URL...", "loading");
  importSourceButton.disabled = true;

  try {
    const response = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: sourceUrl }),
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Failed to extract source.");
    }

    state.importContext = data.discovery || null;
    populateFormFromExtracted(data.extracted || {}, data.detectedType);
    const ingredientCount = (data.extracted?.ingredients || []).length;
    const stepCount = (data.extracted?.steps || []).length;
    if (ingredientCount === 0 || stepCount === 0) {
      setImportStatus(
        "Source analyzed, but full ingredients/steps were not found. You can edit manually and normalize.",
        "error"
      );
      return;
    }

    recipeForm.requestSubmit();
    setImportStatus(`Imported ${ingredientCount} ingredients and ${stepCount} steps.`, "success");
  } catch (error) {
    state.importContext = null;
    setImportStatus(error.message || "Import failed.", "error");
  } finally {
    importSourceButton.disabled = false;
  }
}

function populateFormFromExtracted(extracted, detectedType) {
  if (detectedType && SOURCE_TYPE_LABELS[detectedType]) {
    document.getElementById("sourceType").value = detectedType;
  }

  if (extracted.title) {
    document.getElementById("title").value = extracted.title;
  }
  if (extracted.author) {
    document.getElementById("author").value = extracted.author;
  }
  if (extracted.imageUrl) {
    document.getElementById("imageUrl").value = extracted.imageUrl;
  }
  if (Array.isArray(extracted.ingredients) && extracted.ingredients.length > 0) {
    document.getElementById("ingredientsRaw").value = extracted.ingredients.join("\n");
  }
  if (Array.isArray(extracted.steps) && extracted.steps.length > 0) {
    document.getElementById("stepsRaw").value = extracted.steps.join("\n");
  }
  if (extracted.creditNotes) {
    const creditField = document.getElementById("creditNotes");
    const existing = creditField.value.trim();
    creditField.value = existing ? `${existing}\n${extracted.creditNotes}` : extracted.creditNotes;
  }
}

function setImportStatus(message, type) {
  importStatus.textContent = message || "";
  importStatus.dataset.state = type || "";
}

function normalizeRecipe(payload) {
  const ingredients = parseIngredients(payload.ingredientsRaw || "");
  const steps = parseSteps(payload.stepsRaw || "");
  applyStepUsage(ingredients, steps);
  const bowlResult = buildBowlPlan(ingredients, steps);

  for (const ingredient of ingredients) {
    ingredient.bowl = bowlResult.lookup[ingredient.id] || "Separate";
  }

  const meta = {
    id: buildId(),
    title: (payload.title || "Untitled Recipe").trim(),
    author: (payload.author || "").trim(),
    sourceType: payload.sourceType || "manual",
    sourceUrl: (payload.sourceUrl || "").trim(),
    servings: sanitizeNumber(payload.servings, 4),
    creditNotes: (payload.creditNotes || "").trim(),
    imageUrl: (payload.imageUrl || "").trim(),
    normalizedAt: new Date().toISOString(),
  };

  const mise = buildMiseList(ingredients, bowlResult.bowls, steps);
  const shopping = buildShoppingList(ingredients);
  const discovery = cloneImportContext(state.importContext);
  const citation = buildCitation(meta, discovery);
  const checkState = { mise: {}, steps: {}, shopping: {} };

  const recipe = {
    meta,
    ingredients,
    steps,
    bowls: bowlResult.bowls,
    separate: bowlResult.separate,
    mise,
    shopping,
    citation,
    discovery,
    checkState,
  };

  recipe.markdown = toMarkdown(recipe);
  recipe.json = JSON.stringify(recipe, null, 2);
  return recipe;
}

function parseIngredients(raw) {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => parseIngredientLine(line, index));
}

function parseIngredientLine(line, index) {
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
  let name = (commaSplit.shift() || "").trim();
  let prep = commaSplit.join(",").trim();

  const parenParts = [...name.matchAll(/\(([^)]+)\)/g)].map((part) => part[1].trim());
  if (parenParts.length > 0) {
    prep = [prep, ...parenParts].filter(Boolean).join("; ");
    name = name.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  }

  if (!prep && PREP_PATTERN.test(core)) {
    const prepMatch = core.match(PREP_PATTERN);
    if (prepMatch) {
      prep = prepMatch[1].toLowerCase();
    }
  }

  if (!name) {
    name = cleaned;
  }

  return {
    id: `ing-${index}-${buildId()}`,
    raw: cleaned,
    quantity,
    unit,
    name,
    prep,
    category: inferCategory(name),
    firstStep: 0,
    bowl: "",
    keywords: buildKeywords(name),
  };
}

function parseSteps(raw) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\d+[\.\)\-\s]*/, "").trim());
}

function applyStepUsage(ingredients, steps) {
  const normalizedSteps = steps.map((step) => normalizeForMatch(step));
  for (const ingredient of ingredients) {
    let first = 0;
    const words = ingredient.keywords.length > 0 ? ingredient.keywords : [normalizeForMatch(ingredient.name)];

    for (let index = 0; index < normalizedSteps.length; index += 1) {
      const step = normalizedSteps[index];
      const matches = words.filter((word) => step.includes(word)).length;
      if (matches > 0) {
        first = index;
        break;
      }
    }

    ingredient.firstStep = first;
  }
}

function buildBowlPlan(ingredients, steps) {
  const grouped = new Map();
  const separate = [];
  const lookup = {};

  for (const ingredient of ingredients) {
    const stepIndex = ingredient.firstStep;
    const stepText = steps[stepIndex] || "";
    const reason = shouldStaySeparate(ingredient, stepText);

    if (reason) {
      separate.push({
        ingredient: ingredient.name,
        step: stepIndex + 1,
        reason,
      });
      lookup[ingredient.id] = "Separate";
      continue;
    }

    if (!grouped.has(stepIndex)) {
      grouped.set(stepIndex, []);
    }
    grouped.get(stepIndex).push(ingredient);
  }

  const bowls = [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([stepIndex, items], bowlIndex) => {
      const name = `Bowl ${bowlIndex + 1}`;
      for (const item of items) {
        lookup[item.id] = name;
      }
      return {
        name,
        step: stepIndex + 1,
        stepText: steps[stepIndex] || "",
        ingredients: items.map((item) => item.name),
      };
    });

  return { bowls, separate, lookup };
}

function shouldStaySeparate(ingredient, stepText) {
  if (/\b(divided|for garnish|for serving|reserved|optional topping)\b/i.test(ingredient.raw)) {
    return "Marked as divided or garnish in source.";
  }

  if (/\b(one at a time|separately|set aside)\b/i.test(stepText)) {
    return "Step indicates separate additions.";
  }

  return "";
}

function buildMiseList(ingredients, bowls, steps) {
  const tasks = [];
  const unique = new Set();

  const preheatStep = steps.find((step) => /\bpreheat\b/i.test(step));
  if (preheatStep) {
    tasks.push(`Preheat equipment as noted: "${preheatStep}"`);
  }

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

  return tasks.filter((task) => {
    const key = task.toLowerCase();
    if (unique.has(key)) {
      return false;
    }
    unique.add(key);
    return true;
  });
}

function buildShoppingList(ingredients) {
  const merged = new Map();

  for (const ingredient of ingredients) {
    const normalizedName = normalizeForMatch(ingredient.name);
    const key = `${normalizedName}|${ingredient.unit.toLowerCase()}`;
    const qtyValue = parseQuantity(ingredient.quantity);

    if (!merged.has(key)) {
      merged.set(key, {
        name: ingredient.name,
        unit: ingredient.unit,
        category: ingredient.category,
        quantityNumber: qtyValue,
        quantityText: ingredient.quantity || "",
      });
      continue;
    }

    const existing = merged.get(key);
    if (existing.quantityNumber !== null && qtyValue !== null) {
      existing.quantityNumber += qtyValue;
      existing.quantityText = formatNumber(existing.quantityNumber);
    } else if (ingredient.quantity) {
      existing.quantityText = [existing.quantityText, ingredient.quantity].filter(Boolean).join(" + ");
      existing.quantityNumber = null;
    }
  }

  const byCategory = {};

  for (const item of merged.values()) {
    if (!byCategory[item.category]) {
      byCategory[item.category] = [];
    }
    byCategory[item.category].push({
      ...item,
      buyUrl: `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(item.name)}`,
    });
  }

  for (const categoryName of Object.keys(byCategory)) {
    byCategory[categoryName].sort((a, b) => a.name.localeCompare(b.name));
  }

  return byCategory;
}

function buildCitation(meta, discovery) {
  const dateLabel = new Date(meta.normalizedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const sourceType = SOURCE_TYPE_LABELS[meta.sourceType] || SOURCE_TYPE_LABELS.manual;
  const defaultCredit = meta.author
    ? `Adapted from ${meta.author}. Keep attribution when republishing.`
    : "Original source credit should be preserved when republishing.";

  return {
    sourceType,
    sourceUrl: meta.sourceUrl,
    author: meta.author,
    capturedOn: dateLabel,
    creditLine: meta.creditNotes || defaultCredit,
    extractionMethod: discovery?.method || "manual-input",
    references: buildReferenceList(meta.sourceUrl, discovery?.recipeLinks || []),
  };
}

function toMarkdown(recipe) {
  const references = recipe.citation.references || [];
  const lines = [];
  lines.push(`# ${recipe.meta.title}`);
  lines.push("");
  lines.push(`- Servings: ${recipe.meta.servings}`);
  lines.push(`- Normalized: ${new Date(recipe.meta.normalizedAt).toLocaleString()}`);
  lines.push(`- Source Type: ${recipe.citation.sourceType}`);
  if (recipe.citation.sourceUrl) {
    lines.push(`- Source URL: ${recipe.citation.sourceUrl}`);
  }
  if (recipe.citation.author) {
    lines.push(`- Original Author: ${recipe.citation.author}`);
  }
  lines.push(`- Extraction Method: ${recipe.citation.extractionMethod}`);
  lines.push("");
  lines.push("## Ingredients");
  lines.push("");
  lines.push("| Qty | Unit | Ingredient | Prep | First Step | Bowl |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const ingredient of recipe.ingredients) {
    lines.push(
      `| ${ingredient.quantity || "-"} | ${ingredient.unit || "-"} | ${ingredient.name} | ${ingredient.prep || "-"} | ${ingredient.firstStep + 1} | ${ingredient.bowl || "-"} |`
    );
  }

  lines.push("");
  lines.push("## Mise en Place");
  lines.push("");
  for (const task of recipe.mise) {
    lines.push(`- [ ] ${task}`);
  }

  lines.push("");
  lines.push("## Bowl Plan");
  lines.push("");
  for (const bowl of recipe.bowls) {
    lines.push(`- **${bowl.name}** for Step ${bowl.step}: ${bowl.ingredients.join(", ")}`);
  }
  if (recipe.separate.length > 0) {
    lines.push("- Keep Separate:");
    for (const item of recipe.separate) {
      lines.push(`  - ${item.ingredient} (Step ${item.step}): ${item.reason}`);
    }
  }

  lines.push("");
  lines.push("## Steps");
  lines.push("");
  recipe.steps.forEach((step, index) => lines.push(`${index + 1}. [ ] ${step}`));

  lines.push("");
  lines.push("## Citation");
  lines.push("");
  lines.push(`- ${recipe.citation.creditLine}`);
  lines.push(`- Captured on: ${recipe.citation.capturedOn}`);
  if (references.length > 0) {
    for (const reference of references) {
      lines.push(`- Reference: ${reference}`);
    }
  }

  if (recipe.discovery?.transcriptAvailable) {
    lines.push("- Transcript: Available and analyzed.");
  } else if (recipe.meta.sourceType === "youtube") {
    lines.push("- Transcript: Not available from the source.");
  }

  if (recipe.discovery?.notes?.length > 0) {
    lines.push("- Source Discovery Notes:");
    for (const note of recipe.discovery.notes) {
      lines.push(`  - ${note}`);
    }
  }

  return lines.join("\n");
}

function renderRecipe(recipe) {
  const safeRecipe = hydrateRecipe(recipe);
  state.currentRecipe = safeRecipe;

  renderSummary(safeRecipe);
  renderImage(safeRecipe);
  renderIngredients(safeRecipe);
  renderMise(safeRecipe);
  renderBowlPlan(safeRecipe);
  renderSteps(safeRecipe);
  renderShopping(safeRecipe);
  renderCitation(safeRecipe);
  renderDiscovery(safeRecipe);
  renderRetailerPack();
  markdownOutput.value = safeRecipe.markdown || toMarkdown(safeRecipe);
  void buildRetailerPackForCurrentRecipe();
}

function renderSummary(recipe) {
  recipeSummary.classList.remove("empty");
  recipeSummary.innerHTML = `
    <h3>${escapeHtml(recipe.meta.title)}</h3>
    <p>
      <strong>Servings:</strong> ${escapeHtml(String(recipe.meta.servings))}
      <span class="dot">•</span>
      <strong>Source:</strong> ${escapeHtml(recipe.citation.sourceType)}
    </p>
    <p>${escapeHtml(recipe.citation.creditLine)}</p>
  `;
}

function renderImage(recipe) {
  if (!recipe.meta.imageUrl) {
    imageWrap.hidden = true;
    recipeImage.removeAttribute("src");
    return;
  }
  recipeImage.src = recipe.meta.imageUrl;
  imageWrap.hidden = false;
}

function renderIngredients(recipe) {
  ingredientsTableBody.innerHTML = recipe.ingredients
    .map(
      (ingredient) => `
      <tr>
        <td>${escapeHtml(ingredient.quantity || "-")}</td>
        <td>${escapeHtml(ingredient.unit || "-")}</td>
        <td>${escapeHtml(ingredient.name)}</td>
        <td>${escapeHtml(ingredient.prep || "-")}</td>
        <td>${escapeHtml(String(ingredient.firstStep + 1))}</td>
        <td>${escapeHtml(ingredient.bowl || "-")}</td>
      </tr>
    `
    )
    .join("");
}

function renderMise(recipe) {
  miseList.innerHTML = recipe.mise
    .map((task, index) => {
      const checked = recipe.checkState.mise[index] ? "checked" : "";
      return `
        <li>
          <label>
            <input type="checkbox" data-check-group="mise" data-check-id="${index}" ${checked} />
            <span>${escapeHtml(task)}</span>
          </label>
        </li>
      `;
    })
    .join("");
}

function renderBowlPlan(recipe) {
  bowlPlan.innerHTML = recipe.bowls
    .map(
      (bowl, index) => `
      <article class="bowl-card" style="--delay:${index * 80}ms;">
        <h4>${escapeHtml(bowl.name)} <span>Step ${escapeHtml(String(bowl.step))}</span></h4>
        <p>${escapeHtml(bowl.stepText || "Use in this step.")}</p>
        <p><strong>Use together:</strong> ${escapeHtml(bowl.ingredients.join(", "))}</p>
      </article>
    `
    )
    .join("");

  if (recipe.separate.length === 0) {
    separateItems.innerHTML = "";
    return;
  }

  separateItems.innerHTML = `
    <h4>Keep Separate</h4>
    <ul>
      ${recipe.separate
        .map(
          (item) =>
            `<li>${escapeHtml(item.ingredient)} (Step ${escapeHtml(String(item.step))}): ${escapeHtml(item.reason)}</li>`
        )
        .join("")}
    </ul>
  `;
}

function renderSteps(recipe) {
  stepsChecklist.innerHTML = recipe.steps
    .map((step, index) => {
      const checked = recipe.checkState.steps[index] ? "checked" : "";
      return `
        <li>
          <label>
            <input type="checkbox" data-check-group="steps" data-check-id="${index}" ${checked} />
            <span>${escapeHtml(step)}</span>
          </label>
        </li>
      `;
    })
    .join("");
}

function renderShopping(recipe) {
  if (!recipe) {
    shoppingList.innerHTML = "";
    return;
  }
  const categories = Object.keys(recipe.shopping);
  if (categories.length === 0) {
    shoppingList.innerHTML = "<p>No ingredients available.</p>";
    return;
  }

  shoppingList.innerHTML = categories
    .sort((a, b) => a.localeCompare(b))
    .map((category) => {
      const items = recipe.shopping[category]
        .map((item, index) => {
          const key = `${category}-${index}`;
          const checked = recipe.checkState.shopping[key] ? "checked" : "";
          const qtyLabel = [item.quantityText || "-", item.unit || ""].join(" ").trim();
          const itemLinks = buildItemRetailerLinks(item.name);
          return `
            <li>
              <label>
                <input type="checkbox" data-check-group="shopping" data-check-id="${escapeHtml(key)}" ${checked} />
                <span>${escapeHtml(qtyLabel)} ${escapeHtml(item.name)}</span>
              </label>
              <div class="item-retailer-links">${itemLinks}</div>
            </li>
          `;
        })
        .join("");
      return `
        <article class="shop-category">
          <h4>${escapeHtml(category)}</h4>
          <ul>${items}</ul>
        </article>
      `;
    })
    .join("");
}

function buildItemRetailerLinks(ingredientName) {
  const providers = [
    { id: "instacart", label: "Instacart" },
    { id: "walmart", label: "Walmart" },
    { id: "amazon", label: "Amazon" },
  ];

  return providers
    .map((provider) => {
      const href = buildRetailerItemUrl(provider.id, ingredientName);
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(provider.label)}</a>`;
    })
    .join("");
}

async function buildRetailerPackForCurrentRecipe() {
  if (!state.currentRecipe) {
    state.retailerPack = null;
    renderRetailerPack();
    return;
  }

  const ingredients = flattenShoppingItems(state.currentRecipe);
  if (ingredients.length === 0) {
    state.retailerPack = null;
    renderRetailerPack();
    return;
  }

  buildRetailerLinksButton.disabled = true;
  try {
    const data = await apiRequest("/api/retailers/cart-links", {
      method: "POST",
      body: JSON.stringify({ ingredients }),
    });
    state.retailerPack = data;
  } catch (error) {
    state.retailerPack = null;
    retailerLinks.innerHTML = `<p class="muted">${escapeHtml(error.message || "Could not build retailer links.")}</p>`;
  } finally {
    buildRetailerLinksButton.disabled = false;
    renderRetailerPack();
  }
}

function renderRetailerPack() {
  if (!state.currentRecipe) {
    retailerLinks.innerHTML = "<p class='muted'>Normalize a recipe to generate retailer cart links.</p>";
    return;
  }

  if (!state.retailerPack?.providers || state.retailerPack.providers.length === 0) {
    retailerLinks.innerHTML = "<p class='muted'>Build retailer cart links for this recipe.</p>";
    return;
  }

  const selected = retailerSelect.value || "instacart";
  const providers = state.retailerPack.providers;
  const preferred =
    providers.find((provider) => provider.id === selected) ||
    providers[0];

  retailerLinks.innerHTML = `
    <article class="retailer-card">
      <h4>
        <span>${escapeHtml(preferred.label)} Cart Pack</span>
        <a href="${escapeHtml(preferred.cartUrl)}" target="_blank" rel="noopener noreferrer">Open</a>
      </h4>
      <p>${escapeHtml(state.retailerPack.note || "")}</p>
    </article>
    ${providers
      .filter((provider) => provider.id !== preferred.id)
      .map(
        (provider) => `
      <article class="retailer-card">
        <h4>
          <span>${escapeHtml(provider.label)} Cart Pack</span>
          <a href="${escapeHtml(provider.cartUrl)}" target="_blank" rel="noopener noreferrer">Open</a>
        </h4>
      </article>`
      )
      .join("")}
  `;
}

function flattenShoppingItems(recipe) {
  const items = [];
  for (const category of Object.keys(recipe.shopping || {})) {
    for (const item of recipe.shopping[category]) {
      items.push({
        name: item.name,
        unit: item.unit,
        quantity: item.quantityText,
      });
    }
  }
  return items;
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

function renderCitation(recipe) {
  const refs = recipe.citation.references || [];
  const refsHtml =
    refs.length === 0
      ? "<p><strong>References:</strong> No source URL provided.</p>"
      : `<p><strong>References:</strong> ${refs
          .map(
            (reference) =>
              `<a href="${escapeHtml(reference)}" target="_blank" rel="noopener noreferrer">${escapeHtml(reference)}</a>`
          )
          .join("<br />")}</p>`;

  citationBlock.innerHTML = `
    <p><strong>Credit:</strong> ${escapeHtml(recipe.citation.creditLine)}</p>
    <p><strong>Original Author:</strong> ${escapeHtml(recipe.citation.author || "Unknown / not provided")}</p>
    <p><strong>Captured:</strong> ${escapeHtml(recipe.citation.capturedOn)}</p>
    <p><strong>Extraction:</strong> ${escapeHtml(recipe.citation.extractionMethod)}</p>
    ${refsHtml}
  `;
}

function renderDiscovery(recipe) {
  const discovery = recipe.discovery;
  if (!discovery) {
    sourceDiscovery.innerHTML =
      "<p class='muted'>No automated source discovery was used for this recipe.</p>";
    return;
  }

  const links = discovery.recipeLinks || [];
  const notes = discovery.notes || [];
  const transcriptLabel = discovery.transcriptAvailable
    ? "Transcript found and parsed."
    : "Transcript unavailable.";

  sourceDiscovery.innerHTML = `
    <p><strong>Detection:</strong> ${escapeHtml(discovery.detectedType || recipe.meta.sourceType)}</p>
    <p><strong>Transcript:</strong> ${escapeHtml(transcriptLabel)}</p>
    ${
      links.length > 0
        ? `<p><strong>Discovered Links:</strong><br />${links
            .map(
              (link) =>
                `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link)}</a>`
            )
            .join("<br />")}</p>`
        : "<p><strong>Discovered Links:</strong> None detected.</p>"
    }
    ${
      notes.length > 0
        ? `<p><strong>Notes:</strong><br />${notes.map((note) => escapeHtml(note)).join("<br />")}</p>`
        : ""
    }
  `;
}

function onChecklistChange(event) {
  const element = event.target;
  if (!(element instanceof HTMLInputElement)) {
    return;
  }
  if (!element.matches("input[type='checkbox'][data-check-group]")) {
    return;
  }
  if (!state.currentRecipe) {
    return;
  }

  const group = element.dataset.checkGroup;
  const id = element.dataset.checkId;
  if (!group || !id) {
    return;
  }

  state.currentRecipe.checkState[group][id] = element.checked;
}

function copyMarkdown() {
  if (!state.currentRecipe) {
    return;
  }
  copyToClipboard(state.currentRecipe.markdown, document.getElementById("copyMarkdown"));
}

function copyJson() {
  if (!state.currentRecipe) {
    return;
  }
  copyToClipboard(state.currentRecipe.json, document.getElementById("copyJson"));
}

function copyToClipboard(text, button) {
  navigator.clipboard
    .writeText(text)
    .then(() => flashButton(button, "Copied"))
    .catch(() => flashButton(button, "Clipboard blocked"));
}

function flashButton(button, message) {
  if (!button) {
    return;
  }
  const original = button.textContent;
  button.textContent = message;
  window.setTimeout(() => {
    button.textContent = original;
  }, 1400);
}

async function saveCurrentRecipe() {
  if (!state.currentRecipe) {
    return;
  }
  const saveButton = document.getElementById("saveRecipe");
  saveButton.disabled = true;
  try {
    if (state.authToken) {
      const data = await apiRequest("/api/recipes", {
        method: "POST",
        body: JSON.stringify({ recipe: state.currentRecipe }),
      });
      const savedRecipe = data.recipe || state.currentRecipe;
      const existingIndex = state.library.findIndex((item) => item.meta.id === savedRecipe.meta.id);
      if (existingIndex >= 0) {
        state.library[existingIndex] = savedRecipe;
      } else {
        state.library.unshift(savedRecipe);
      }
    } else {
      const existingIndex = state.library.findIndex((item) => item.meta.id === state.currentRecipe.meta.id);
      if (existingIndex >= 0) {
        state.library[existingIndex] = state.currentRecipe;
      } else {
        state.library.unshift(state.currentRecipe);
      }
      writeLocalLibrary(state.library);
    }

    renderLibrary(librarySearch.value);
    flashButton(saveButton, "Saved");
  } catch (error) {
    flashButton(saveButton, "Save failed");
    setAuthStatus(error.message || "Could not save recipe.", "error");
  } finally {
    saveButton.disabled = false;
  }
}

async function onLibraryAction(event) {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  const action = target.dataset.action;
  const id = target.dataset.id;
  if (!action || !id) {
    return;
  }

  if (action === "open") {
    const recipe = state.library.find((item) => item.meta.id === id);
    if (recipe) {
      state.currentRecipe = recipe;
      renderRecipe(recipe);
    }
    return;
  }

  if (action === "delete") {
    try {
      if (state.authToken) {
        await apiRequest(`/api/recipes/${encodeURIComponent(id)}`, { method: "DELETE" });
      } else {
        writeLocalLibrary(state.library.filter((item) => item.meta.id !== id));
      }
      state.library = state.library.filter((item) => item.meta.id !== id);
      renderLibrary(librarySearch.value);
    } catch (error) {
      setAuthStatus(error.message || "Could not delete recipe.", "error");
    }
  }
}

function renderLibrary(searchTerm = "") {
  const query = (searchTerm || "").trim().toLowerCase();
  const recipes = query
    ? state.library.filter((recipe) => recipe.meta.title.toLowerCase().includes(query))
    : state.library;

  libraryCount.textContent = `${recipes.length} saved`;
  if (recipes.length === 0) {
    libraryList.innerHTML = "<p class='empty-library'>No saved recipes yet.</p>";
    return;
  }

  libraryList.innerHTML = recipes
    .map(
      (recipe) => `
      <article class="library-card">
        <h3>${escapeHtml(recipe.meta.title)}</h3>
        <p>${escapeHtml(SOURCE_TYPE_LABELS[recipe.meta.sourceType] || "Recipe")}</p>
        <p>${escapeHtml(new Date(recipe.meta.normalizedAt).toLocaleDateString())}</p>
        <div class="button-row tight">
          <button class="btn btn-secondary" type="button" data-action="open" data-id="${escapeHtml(recipe.meta.id)}">Open</button>
          <button class="btn btn-ghost" type="button" data-action="delete" data-id="${escapeHtml(recipe.meta.id)}">Delete</button>
        </div>
      </article>
    `
    )
    .join("");
}

function clearOutput() {
  state.currentRecipe = null;
  state.importContext = null;
  state.retailerPack = null;
  recipeSummary.classList.add("empty");
  recipeSummary.innerHTML = `
    <h3>Your normalized recipe appears here</h3>
    <p>Paste a recipe source and click <strong>Normalize Recipe</strong>.</p>
  `;
  ingredientsTableBody.innerHTML = "";
  miseList.innerHTML = "";
  bowlPlan.innerHTML = "";
  separateItems.innerHTML = "";
  stepsChecklist.innerHTML = "";
  shoppingList.innerHTML = "";
  citationBlock.innerHTML = "";
  sourceDiscovery.innerHTML =
    "<p class='muted'>Import a source URL to see discovered recipe links and transcript details.</p>";
  retailerLinks.innerHTML = "<p class='muted'>Normalize a recipe to generate retailer cart links.</p>";
  markdownOutput.value = EMPTY_MARKDOWN_PLACEHOLDER;
  imageWrap.hidden = true;
  recipeImage.removeAttribute("src");
  setImportStatus("", "");
}

function loadSample() {
  document.getElementById("title").value = "One-Pan Lemon Garlic Chicken & Greens";
  document.getElementById("author").value = "MiseFlow Demo Kitchen";
  document.getElementById("sourceType").value = "youtube";
  document.getElementById("sourceUrl").value = "https://www.youtube.com/watch?v=example";
  document.getElementById("imageUrl").value =
    "https://images.unsplash.com/photo-1604908177078-3f20de5e6ea1?auto=format&fit=crop&w=1000&q=80";
  document.getElementById("servings").value = "4";
  document.getElementById("creditNotes").value =
    "Adapted from original demo recipe. Timing and bowl staging reorganized for faster prep.";
  document.getElementById("ingredientsRaw").value = [
    "1.5 lb boneless chicken thighs",
    "1 tbsp kosher salt",
    "1 tsp black pepper",
    "2 tbsp olive oil",
    "4 cloves garlic, minced",
    "1 lemon, zested and juiced",
    "5 oz baby spinach",
    "1/2 cup chicken broth",
    "1 tbsp butter",
    "2 tbsp chopped parsley, for garnish",
  ].join("\n");
  document.getElementById("stepsRaw").value = [
    "1. Pat chicken dry and season with salt and pepper.",
    "2. Heat olive oil in a large skillet and sear chicken until browned.",
    "3. Add garlic, lemon zest, and broth, then simmer for 5 minutes.",
    "4. Stir in spinach and butter until wilted.",
    "5. Finish with lemon juice and parsley for garnish before serving.",
  ].join("\n");
  state.importContext = {
    method: "sample",
    detectedType: "youtube",
    transcriptAvailable: true,
    recipeLinks: ["https://www.youtube.com/watch?v=example"],
    notes: ["Demo recipe loaded locally."],
  };
  setImportStatus("Demo recipe loaded.", "success");
}

function readLocalLibrary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function writeLocalLibrary(library) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
}

function cloneImportContext(context) {
  if (!context) {
    return null;
  }
  return JSON.parse(JSON.stringify(context));
}

function buildReferenceList(primaryUrl, discoveredLinks) {
  const seen = new Set();
  const references = [];

  const add = (value) => {
    if (!value) {
      return;
    }
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    references.push(normalized);
  };

  add(primaryUrl || "");
  for (const link of discoveredLinks || []) {
    add(link);
  }
  return references;
}

function hydrateRecipe(recipe) {
  if (!recipe || typeof recipe !== "object") {
    return {
      meta: { title: "Untitled Recipe", servings: 1, sourceType: "manual", normalizedAt: new Date().toISOString() },
      ingredients: [],
      steps: [],
      bowls: [],
      separate: [],
      mise: [],
      shopping: {},
      citation: buildCitation(
        { title: "Untitled Recipe", sourceType: "manual", normalizedAt: new Date().toISOString() },
        null
      ),
      discovery: null,
      checkState: { mise: {}, steps: {}, shopping: {} },
      markdown: "",
      json: "",
    };
  }

  if (!recipe.checkState || typeof recipe.checkState !== "object") {
    recipe.checkState = { mise: {}, steps: {}, shopping: {} };
  }
  recipe.checkState.mise = recipe.checkState.mise || {};
  recipe.checkState.steps = recipe.checkState.steps || {};
  recipe.checkState.shopping = recipe.checkState.shopping || {};
  recipe.ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  recipe.steps = Array.isArray(recipe.steps) ? recipe.steps : [];
  recipe.bowls = Array.isArray(recipe.bowls) ? recipe.bowls : [];
  recipe.separate = Array.isArray(recipe.separate) ? recipe.separate : [];
  recipe.mise = Array.isArray(recipe.mise) ? recipe.mise : [];
  recipe.shopping = recipe.shopping && typeof recipe.shopping === "object" ? recipe.shopping : {};
  recipe.meta = recipe.meta && typeof recipe.meta === "object" ? recipe.meta : {};
  recipe.meta.title = recipe.meta.title || "Untitled Recipe";
  recipe.meta.sourceType = recipe.meta.sourceType || "manual";
  recipe.meta.servings = recipe.meta.servings || 1;
  recipe.meta.normalizedAt = recipe.meta.normalizedAt || new Date().toISOString();
  recipe.citation =
    recipe.citation && typeof recipe.citation === "object"
      ? recipe.citation
      : buildCitation(recipe.meta, recipe.discovery || null);
  recipe.markdown = recipe.markdown || toMarkdown(recipe);
  recipe.json = recipe.json || JSON.stringify(recipe, null, 2);
  return recipe;
}

function inferCategory(name) {
  const normalized = normalizeForMatch(name);
  for (const rule of CATEGORY_RULES) {
    if (rule.words.some((word) => normalized.includes(word))) {
      return rule.name;
    }
  }
  return "Other";
}

function buildKeywords(name) {
  return normalizeForMatch(name)
    .split(" ")
    .filter((word) => word.length > 2 && !STOPWORDS.has(word))
    .slice(0, 5);
}

function normalizeForMatch(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseQuantity(value) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (/^\d*\.\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (/^\d+\/\d+$/.test(trimmed)) {
    const [numerator, denominator] = trimmed.split("/").map(Number);
    return denominator === 0 ? null : numerator / denominator;
  }
  if (/^\d+\s+\d+\/\d+$/.test(trimmed)) {
    const [whole, fraction] = trimmed.split(/\s+/);
    const [numerator, denominator] = fraction.split("/").map(Number);
    if (denominator === 0) {
      return null;
    }
    return Number(whole) + numerator / denominator;
  }
  return null;
}

function formatNumber(value) {
  if (value === null || Number.isNaN(value)) {
    return "";
  }
  return Number(value.toFixed(2)).toString();
}

function sanitizeNumber(raw, fallback) {
  const value = Number(raw);
  if (Number.isNaN(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function buildId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function capitalize(text) {
  if (!text) {
    return "";
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

init();
