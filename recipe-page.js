const slug = document.body?.dataset?.recipeSlug || window.location.pathname;
const storageKey = `miseflow:progress:${slug}`;

const toggleCookModeButton = document.getElementById("toggleCookMode");
const resetChecklistButton = document.getElementById("resetChecklist");
const stepPrevButton = document.getElementById("stepPrev");
const stepNextButton = document.getElementById("stepNext");
const stepDoneButton = document.getElementById("stepDone");
const focusStepNumber = document.getElementById("focusStepNumber");
const focusStepText = document.getElementById("focusStepText");
const progressLabel = document.getElementById("progressLabel");
const progressBar = document.getElementById("progressBar");
const progressTrack = document.getElementById("progressTrack");
const toggleIngredientVisualsButton = document.getElementById("toggleIngredientVisuals");
const ingredientVisualGrid = document.getElementById("ingredientVisualGrid");

const checklistInputs = [...document.querySelectorAll("input[type='checkbox'][data-check-group][data-check-id]")];
const stepItems = [...document.querySelectorAll(".step-item[data-step-index]")];
const jumpButtons = [...document.querySelectorAll("[data-step-jump]")];
const ingredientVisualCards = [...document.querySelectorAll(".visual-card[data-ingredient-query]")];

const UNIT_PATTERN =
  /\b(cups?|cup|tbsp|tablespoons?|tsp|teaspoons?|pounds?|lbs?|lb|ounces?|oz|grams?|g|kilograms?|kg|ml|l|cloves?|clove|cans?|can|packages?|package|pkg|pinch|dash|slices?|slice)\b/gi;
const INGREDIENT_IMAGE_CACHE_PREFIX = "miseflow:ingredient-image:v1:";

const stepEntries = stepItems
  .map((item) => {
    const stepNumber = Number(item.dataset.stepIndex || 0);
    const input = item.querySelector("input[type='checkbox'][data-check-group='steps']");
    const textNode = item.querySelector(".step-copy");
    if (!stepNumber || !input || !textNode) {
      return null;
    }
    const stepText = String(item.dataset.stepText || "").trim();
    return {
      stepNumber,
      item,
      input,
      text: stepText || normalizeStepText(textNode.textContent || ""),
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.stepNumber - b.stepNumber);

const stepByNumber = new Map(stepEntries.map((entry) => [entry.stepNumber, entry]));

const state = loadState();
initialize();

function initialize() {
  bindChecklistHandlers();
  bindStepControls();
  bindGlobalControls();

  applyStoredChecks();
  state.currentStep = normalizeCurrentStep(state.currentStep);
  if (!state.currentStep && stepEntries.length > 0) {
    state.currentStep = findFirstIncompleteStep();
  }
  if (!state.currentStep) {
    state.currentStep = stepEntries.length > 0 ? 1 : 0;
  }
  setCookMode(Boolean(state.cookMode), false);
  setIngredientVisualsOpen(Boolean(state.visualsOpen));
  updateStepFocus(false);
  updateStepStyles();
  updateProgress();
  saveState();
}

function bindChecklistHandlers() {
  for (const input of checklistInputs) {
    input.addEventListener("change", () => {
      const group = String(input.dataset.checkGroup || "").trim();
      const id = String(input.dataset.checkId || "").trim();
      setChecked(group, id, input.checked);
      if (group === "steps") {
        updateStepFocus(false);
      }
      updateStepStyles();
      updateProgress();
      saveState();
    });
  }
}

function bindStepControls() {
  for (const button of jumpButtons) {
    button.addEventListener("click", () => {
      const stepNumber = Number(button.dataset.stepJump || 0);
      if (!stepNumber) {
        return;
      }
      state.currentStep = normalizeCurrentStep(stepNumber);
      updateStepFocus(true);
      saveState();
    });
  }

  if (stepPrevButton) {
    stepPrevButton.addEventListener("click", () => {
      if (stepEntries.length === 0) {
        return;
      }
      state.currentStep = normalizeCurrentStep(state.currentStep - 1);
      updateStepFocus(false);
      saveState();
    });
  }

  if (stepNextButton) {
    stepNextButton.addEventListener("click", () => {
      if (stepEntries.length === 0) {
        return;
      }
      state.currentStep = normalizeCurrentStep(state.currentStep + 1);
      updateStepFocus(false);
      saveState();
    });
  }

  if (stepDoneButton) {
    stepDoneButton.addEventListener("click", () => {
      const current = stepByNumber.get(state.currentStep);
      if (!current) {
        return;
      }
      if (!current.input.checked) {
        current.input.checked = true;
        const group = String(current.input.dataset.checkGroup || "").trim();
        const id = String(current.input.dataset.checkId || "").trim();
        setChecked(group, id, true);
      }
      if (state.currentStep < stepEntries.length) {
        state.currentStep = normalizeCurrentStep(state.currentStep + 1);
      }
      updateStepFocus(false);
      updateStepStyles();
      updateProgress();
      saveState();
    });
  }
}

function bindGlobalControls() {
  if (toggleCookModeButton) {
    toggleCookModeButton.addEventListener("click", () => {
      setCookMode(!state.cookMode, true);
      saveState();
    });
  }

  if (resetChecklistButton) {
    resetChecklistButton.addEventListener("click", () => {
      const accepted = window.confirm("Reset all checklists and step progress for this recipe?");
      if (!accepted) {
        return;
      }
      state.checks = { ingredients: {}, mise: {}, steps: {} };
      state.currentStep = stepEntries.length > 0 ? 1 : 0;
      applyStoredChecks();
      updateStepFocus(false);
      updateStepStyles();
      updateProgress();
      saveState();
    });
  }

  if (toggleIngredientVisualsButton && ingredientVisualGrid) {
    toggleIngredientVisualsButton.addEventListener("click", () => {
      setIngredientVisualsOpen(!state.visualsOpen);
      saveState();
    });
  }
}

function setCookMode(enabled, scrollToStep) {
  state.cookMode = enabled;
  document.body.classList.toggle("cook-mode", enabled);
  if (toggleCookModeButton) {
    toggleCookModeButton.textContent = enabled ? "Exit Cook Mode" : "Start Cook Mode";
    toggleCookModeButton.setAttribute("aria-pressed", enabled ? "true" : "false");
  }
  if (enabled) {
    updateStepFocus(Boolean(scrollToStep));
  }
}

function setIngredientVisualsOpen(enabled) {
  if (!toggleIngredientVisualsButton || !ingredientVisualGrid) {
    return;
  }
  state.visualsOpen = Boolean(enabled);
  ingredientVisualGrid.hidden = !state.visualsOpen;
  toggleIngredientVisualsButton.textContent = state.visualsOpen ? "Hide Ingredient Photos" : "Show Ingredient Photos";
  toggleIngredientVisualsButton.setAttribute("aria-pressed", state.visualsOpen ? "true" : "false");
  if (state.visualsOpen) {
    hydrateIngredientVisuals();
  }
}

function hydrateIngredientVisuals() {
  for (const card of ingredientVisualCards) {
    void loadVisualCardImage(card);
  }
}

async function loadVisualCardImage(card) {
  const img = card.querySelector("img");
  if (!img || img.dataset.loaded === "true") {
    return;
  }

  const label = String(card.dataset.ingredientLabel || card.dataset.ingredientQuery || "").trim();
  const category = String(card.dataset.ingredientCategory || "").trim();
  const normalizedQuery = normalizeIngredientQuery(card.dataset.ingredientQuery || label);
  const fallbackUrl = buildFallbackIngredientImage(normalizedQuery || label, category);

  img.src = fallbackUrl;
  img.dataset.loaded = "pending";

  const cached = readIngredientImageCache(normalizedQuery);
  if (cached) {
    img.src = cached;
    img.dataset.loaded = "true";
    card.classList.add("has-photo");
    return;
  }

  const photoUrl = await fetchIngredientPhoto(normalizedQuery);
  if (photoUrl) {
    img.src = photoUrl;
    img.dataset.loaded = "true";
    card.classList.add("has-photo");
    writeIngredientImageCache(normalizedQuery, photoUrl);
    return;
  }

  img.dataset.loaded = "true";
}

function normalizeIngredientQuery(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b\d+(?:\s+\d+\/\d+|\/\d+|\.\d+)?\b/g, " ")
    .replace(UNIT_PATTERN, " ")
    .replace(/[^a-z\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

function readIngredientImageCache(query) {
  if (!query) {
    return "";
  }
  try {
    const raw = localStorage.getItem(`${INGREDIENT_IMAGE_CACHE_PREFIX}${query}`);
    if (!raw) {
      return "";
    }
    const parsed = JSON.parse(raw);
    if (typeof parsed?.url === "string" && parsed.url) {
      return parsed.url;
    }
  } catch {
    return "";
  }
  return "";
}

function writeIngredientImageCache(query, url) {
  if (!query || !url) {
    return;
  }
  try {
    localStorage.setItem(
      `${INGREDIENT_IMAGE_CACHE_PREFIX}${query}`,
      JSON.stringify({
        url,
        savedAt: new Date().toISOString(),
      })
    );
  } catch {
    // Ignore localStorage quota issues.
  }
}

async function fetchIngredientPhoto(query) {
  if (!query || query.length < 2) {
    return "";
  }
  const searchTerm = `${query} food ingredient`;
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrsearch: searchTerm,
    gsrnamespace: "0",
    gsrlimit: "1",
    prop: "pageimages",
    piprop: "thumbnail",
    pithumbsize: "360",
  });

  try {
    const response = await fetch(`https://en.wikipedia.org/w/api.php?${params.toString()}`, {
      cache: "force-cache",
    });
    if (!response.ok) {
      return "";
    }
    const payload = await response.json();
    const pages = payload?.query?.pages;
    if (!pages || typeof pages !== "object") {
      return "";
    }
    for (const page of Object.values(pages)) {
      if (typeof page?.thumbnail?.source === "string" && page.thumbnail.source) {
        return page.thumbnail.source;
      }
    }
  } catch {
    return "";
  }
  return "";
}

function buildFallbackIngredientImage(query, category) {
  const label = String(query || "ingredient").trim() || "ingredient";
  const seed = `${label}:${category}`;
  const emoji = pickIngredientEmoji(label, category);
  const [start, end] = gradientFromSeed(seed);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 200">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${start}" />
        <stop offset="100%" stop-color="${end}" />
      </linearGradient>
    </defs>
    <rect width="280" height="200" rx="24" fill="url(#g)" />
    <text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" font-size="72">${emoji}</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function pickIngredientEmoji(query, category) {
  const categoryKey = String(category || "").toLowerCase();
  if (categoryKey === "produce") {
    return "🥬";
  }
  if (categoryKey === "protein") {
    return "🍗";
  }
  if (categoryKey === "dairy") {
    return "🧀";
  }
  if (categoryKey === "spice") {
    return "🧂";
  }
  if (categoryKey === "pantry") {
    return "🥫";
  }

  const text = String(query || "").toLowerCase();
  if (/\b(onion|garlic|carrot|broccoli|spinach|pepper|tomato)\b/.test(text)) {
    return "🥕";
  }
  if (/\b(chicken|beef|pork|fish|shrimp|turkey|sausage)\b/.test(text)) {
    return "🍖";
  }
  if (/\b(cheese|milk|cream|butter|yogurt)\b/.test(text)) {
    return "🧀";
  }
  if (/\b(flour|rice|pasta|bean|broth|stock|oil)\b/.test(text)) {
    return "🥣";
  }
  return "🍽️";
}

function gradientFromSeed(seed) {
  const palette = [
    ["#f8ddc5", "#f1b18b"],
    ["#d5e9d7", "#8fbe96"],
    ["#d7e7f4", "#90b6d6"],
    ["#f2decb", "#d7b48c"],
    ["#e3d8ef", "#b79ad0"],
    ["#f4dfcc", "#d6a173"],
  ];
  const index = Math.abs(hashCode(seed)) % palette.length;
  return palette[index];
}

function hashCode(value) {
  let hash = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return hash;
}

function applyStoredChecks() {
  for (const input of checklistInputs) {
    const group = String(input.dataset.checkGroup || "").trim();
    const id = String(input.dataset.checkId || "").trim();
    input.checked = Boolean(state.checks?.[group]?.[id]);
  }
}

function updateStepFocus(shouldScroll) {
  if (stepEntries.length === 0) {
    if (focusStepNumber) {
      focusStepNumber.textContent = "No steps";
    }
    if (focusStepText) {
      focusStepText.textContent = "No instructions were extracted for this recipe.";
    }
    if (stepPrevButton) {
      stepPrevButton.disabled = true;
    }
    if (stepNextButton) {
      stepNextButton.disabled = true;
    }
    if (stepDoneButton) {
      stepDoneButton.disabled = true;
    }
    return;
  }

  const current = stepByNumber.get(state.currentStep) || stepEntries[0];
  state.currentStep = current.stepNumber;

  if (focusStepNumber) {
    focusStepNumber.textContent = `Step ${current.stepNumber}`;
  }
  if (focusStepText) {
    focusStepText.textContent = current.text;
  }
  if (stepPrevButton) {
    stepPrevButton.disabled = current.stepNumber <= 1;
  }
  if (stepNextButton) {
    stepNextButton.disabled = current.stepNumber >= stepEntries.length;
  }
  if (stepDoneButton) {
    stepDoneButton.textContent = current.input.checked ? "Step Completed" : "Mark Step Done";
  }

  for (const entry of stepEntries) {
    const active = entry.stepNumber === current.stepNumber;
    entry.item.classList.toggle("is-active", active);
    entry.item.setAttribute("aria-current", active ? "step" : "false");
  }

  if (shouldScroll) {
    current.item.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function updateStepStyles() {
  for (const entry of stepEntries) {
    entry.item.classList.toggle("is-complete", entry.input.checked);
  }
}

function updateProgress() {
  const stepInputs = checklistInputs.filter(
    (input) => String(input.dataset.checkGroup || "").trim() === "steps"
  );
  const completedSteps = stepInputs.filter((input) => input.checked).length;
  const totalSteps = stepInputs.length;
  const allChecked = checklistInputs.filter((input) => input.checked).length;
  const totalChecks = checklistInputs.length;
  const percent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  if (progressLabel) {
    progressLabel.textContent = `${completedSteps} of ${totalSteps} steps complete • ${allChecked}/${totalChecks} tasks checked`;
  }
  if (progressBar) {
    progressBar.style.width = `${percent}%`;
  }
  if (progressTrack) {
    progressTrack.setAttribute("aria-valuenow", String(completedSteps));
  }
}

function setChecked(group, id, checked) {
  if (!group || !id) {
    return;
  }
  if (!state.checks[group]) {
    state.checks[group] = {};
  }
  if (checked) {
    state.checks[group][id] = true;
    return;
  }
  delete state.checks[group][id];
}

function normalizeCurrentStep(stepNumber) {
  if (stepEntries.length === 0) {
    return 0;
  }
  const next = Number(stepNumber || 0);
  if (!Number.isFinite(next)) {
    return 1;
  }
  return Math.min(stepEntries.length, Math.max(1, Math.round(next)));
}

function findFirstIncompleteStep() {
  for (const entry of stepEntries) {
    if (!entry.input.checked) {
      return entry.stepNumber;
    }
  }
  return 1;
}

function loadState() {
  const initial = {
    cookMode: false,
    visualsOpen: false,
    currentStep: 0,
    checks: { ingredients: {}, mise: {}, steps: {} },
  };
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return initial;
    }
    const parsed = JSON.parse(raw);
    return {
      cookMode: Boolean(parsed?.cookMode),
      visualsOpen: Boolean(parsed?.visualsOpen),
      currentStep: Number(parsed?.currentStep || 0),
      checks: {
        ingredients: normalizeCheckMap(parsed?.checks?.ingredients),
        mise: normalizeCheckMap(parsed?.checks?.mise),
        steps: normalizeCheckMap(parsed?.checks?.steps),
      },
    };
  } catch {
    return initial;
  }
}

function normalizeCheckMap(value) {
  if (!value || typeof value !== "object") {
    return {};
  }
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry) {
      output[key] = true;
    }
  }
  return output;
}

function normalizeStepText(value) {
  return String(value || "")
    .replace(/^step\s+\d+\s*:\s*/i, "")
    .trim();
}

function saveState() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Ignore persistence issues in private mode.
  }
}
