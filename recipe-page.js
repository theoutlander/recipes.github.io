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

const checklistInputs = [...document.querySelectorAll("input[type='checkbox'][data-check-group][data-check-id]")];
const stepItems = [...document.querySelectorAll(".step-item[data-step-index]")];
const jumpButtons = [...document.querySelectorAll("[data-step-jump]")];

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
      updateStepFocus(true);
      saveState();
    });
  }

  if (stepNextButton) {
    stepNextButton.addEventListener("click", () => {
      if (stepEntries.length === 0) {
        return;
      }
      state.currentStep = normalizeCurrentStep(state.currentStep + 1);
      updateStepFocus(true);
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
      updateStepFocus(true);
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
    current.item.scrollIntoView({ behavior: "smooth", block: "center" });
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
