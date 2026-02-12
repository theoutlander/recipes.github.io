const state = {
  allRecipes: [],
  search: "",
  sourceType: "all",
};

const recipeGrid = document.getElementById("recipeGrid");
const recipeCount = document.getElementById("recipeCount");
const emptyState = document.getElementById("emptyState");
const searchInput = document.getElementById("searchInput");
const sourceFilter = document.getElementById("sourceFilter");

init();

async function init() {
  searchInput.addEventListener("input", () => {
    state.search = searchInput.value.trim().toLowerCase();
    render();
  });
  sourceFilter.addEventListener("change", () => {
    state.sourceType = sourceFilter.value;
    render();
  });

  await loadRecipes();
  render();
}

async function loadRecipes() {
  try {
    const response = await fetch("recipes/index.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Could not load recipes (${response.status}).`);
    }
    const data = await response.json();
    state.allRecipes = Array.isArray(data.recipes) ? data.recipes : [];
  } catch {
    state.allRecipes = [];
  }
}

function render() {
  const filtered = state.allRecipes.filter((recipe) => {
    const matchesSearch = state.search
      ? [recipe.title, recipe.author, recipe.description]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(state.search)
      : true;
    const matchesSource = state.sourceType === "all" ? true : recipe.sourceType === state.sourceType;
    return matchesSearch && matchesSource;
  });

  recipeCount.textContent = `${filtered.length} recipe${filtered.length === 1 ? "" : "s"}`;
  emptyState.hidden = filtered.length !== 0;

  if (filtered.length === 0) {
    recipeGrid.innerHTML = "";
    return;
  }

  recipeGrid.innerHTML = filtered
    .map((recipe) => {
      const image = recipe.imageUrl
        ? `<img src="${escapeHtml(recipe.imageUrl)}" alt="${escapeHtml(recipe.title)}" loading="lazy" />`
        : `<img alt="No image" loading="lazy" />`;

      return `
        <article class="recipe-card">
          ${image}
          <div class="body">
            <h3>${escapeHtml(recipe.title)}</h3>
            <p class="meta">${escapeHtml(recipe.author || "Unknown author")} • ${escapeHtml(recipe.sourceLabel || "Recipe")}</p>
            <p class="blurb">${escapeHtml(recipe.description || "Open recipe for details.")}</p>
            <a href="${escapeHtml(recipe.url)}">View Recipe</a>
          </div>
        </article>
      `;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
