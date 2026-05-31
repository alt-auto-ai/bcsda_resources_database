const state = {
  allRows: [],
  filteredRows: [],
  filters: {
    title: "",
    theme: [],
    documentType: [],
    year: [],
  },
};

const elements = {
  titleFilter: document.getElementById("title-filter"),
  themeFilter: document.getElementById("theme-filter"),
  documentTypeFilter: document.getElementById("document-type-filter"),
  yearFilter: document.getElementById("year-filter"),
  clearFiltersButton: document.getElementById("clear-filters"),
  resultCount: document.getElementById("result-count"),
  statusMessage: document.getElementById("status-message"),
  tableBody: document.getElementById("resources-tbody"),
  emptyState: document.getElementById("empty-state"),
};

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  loadCsvData();
});

function bindEvents() {
  elements.titleFilter.addEventListener(
    "input",
    debounce(() => {
      state.filters.title = elements.titleFilter.value.trim();
      runFilterPipeline();
    }, 120)
  );

  const handleThemeChange = () => {
    state.filters.theme = getSelectedValues(elements.themeFilter);
    runFilterPipeline();
  };
  const ignoreThemeChange = enableClickToggleMultiSelect(elements.themeFilter, handleThemeChange);
  elements.themeFilter.addEventListener("change", () => {
    if (ignoreThemeChange()) {
      return;
    }
    handleThemeChange();
  });

  const handleDocumentTypeChange = () => {
    state.filters.documentType = getSelectedValues(elements.documentTypeFilter);
    runFilterPipeline();
  };
  const ignoreDocumentTypeChange = enableClickToggleMultiSelect(
    elements.documentTypeFilter,
    handleDocumentTypeChange
  );
  elements.documentTypeFilter.addEventListener("change", () => {
    if (ignoreDocumentTypeChange()) {
      return;
    }
    handleDocumentTypeChange();
  });

  const handleYearChange = () => {
    state.filters.year = getSelectedValues(elements.yearFilter);
    runFilterPipeline();
  };
  const ignoreYearChange = enableClickToggleMultiSelect(elements.yearFilter, handleYearChange);
  elements.yearFilter.addEventListener("change", () => {
    if (ignoreYearChange()) {
      return;
    }
    handleYearChange();
  });

  elements.clearFiltersButton.addEventListener("click", () => {
    state.filters = {
      title: "",
      theme: [],
      documentType: [],
      year: [],
    };

    elements.titleFilter.value = "";
    clearSelectSelection(elements.themeFilter);
    clearSelectSelection(elements.documentTypeFilter);
    clearSelectSelection(elements.yearFilter);

    runFilterPipeline();
  });
}

function enableClickToggleMultiSelect(selectElement, onSelectionChanged) {
  let ignoreNextChange = false;

  selectElement.addEventListener("mousedown", (event) => {
    const option = event.target;
    if (!option || option.tagName !== "OPTION") {
      return;
    }

    event.preventDefault();
    option.selected = !option.selected;
    ignoreNextChange = true;
    onSelectionChanged();
  });

  selectElement.addEventListener("click", (event) => {
    if (event.target && event.target.tagName === "OPTION") {
      event.preventDefault();
    }
  });

  return () => {
    if (!ignoreNextChange) {
      return false;
    }
    ignoreNextChange = false;
    return true;
  };
}

async function loadCsvData() {
  setStatus("Loading output.csv...");

  try {
    const response = await fetch("./output.csv", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Unable to fetch output.csv");
    }

    const csvText = await response.text();
    const parsedRows = parseCsv(csvText);

    state.allRows = parsedRows
      .map(normalizeRow)
      .filter((row) => row.title || row.theme || row.document_type || row.year);

    runFilterPipeline();
    setStatus(`Loaded ${state.allRows.length.toLocaleString()} resources.`);
  } catch (error) {
    state.allRows = [];
    state.filteredRows = [];
    renderTable();
    setStatus(
      "Could not load output.csv. Serve this folder with a local web server (for example: npx serve .).",
      true
    );
  }
}

function runFilterPipeline() {
  updateRelationalDropdowns();
  applyFilters();
  renderTable();
  updateClearButtonState();
}

function applyFilters() {
  const titleQuery = cleanText(state.filters.title);

  state.filteredRows = state.allRows.filter((row) => {
    if (titleQuery && !matchesTitle(row.title, titleQuery)) {
      return false;
    }
    if (state.filters.theme.length && !state.filters.theme.includes(row.theme)) {
      return false;
    }
    if (
      state.filters.documentType.length &&
      !state.filters.documentType.includes(row.document_type)
    ) {
      return false;
    }
    if (state.filters.year.length && !state.filters.year.includes(row.year)) {
      return false;
    }
    return true;
  });
}

function updateRelationalDropdowns() {
  const snapshot = getFilterSnapshot();
  updateDropdown("theme", snapshot);
  updateDropdown("documentType", snapshot);
  updateDropdown("year", snapshot);
}

function updateDropdown(key, filterSnapshot) {
  const config = getDropdownConfig(key);
  const rows = state.allRows.filter((row) => matchesAllFiltersExcept(row, key, filterSnapshot));
  const availableOptions = getUniqueValues(rows, config.valueSelector, config.sortMode);

  const persistedValues = [...new Set(filterSnapshot[key].map(cleanText).filter(Boolean))];
  const displayOptions = mergeOptionsWithSelected(availableOptions, persistedValues);
  buildSelectOptions(config.element, config.placeholder, displayOptions);

  state.filters[key] = persistedValues;
  setSelectedValues(config.element, persistedValues);
  setOptionAvailability(config.element, new Set(availableOptions));
}

function matchesAllFiltersExcept(row, excludedKey, filters = state.filters) {
  const titleQuery = cleanText(filters.title);

  if (excludedKey !== "title" && titleQuery && !matchesTitle(row.title, titleQuery)) {
    return false;
  }
  if (
    excludedKey !== "theme" &&
    filters.theme.length &&
    !filters.theme.includes(row.theme)
  ) {
    return false;
  }
  if (
    excludedKey !== "documentType" &&
    filters.documentType.length &&
    !filters.documentType.includes(row.document_type)
  ) {
    return false;
  }
  if (
    excludedKey !== "year" &&
    filters.year.length &&
    !filters.year.includes(row.year)
  ) {
    return false;
  }
  return true;
}

function getFilterSnapshot() {
  return {
    title: state.filters.title,
    theme: [...state.filters.theme],
    documentType: [...state.filters.documentType],
    year: [...state.filters.year],
  };
}

function getDropdownConfig(key) {
  const configs = {
    theme: {
      element: elements.themeFilter,
      placeholder: "All themes",
      valueSelector: (row) => row.theme,
      sortMode: "alpha",
    },
    documentType: {
      element: elements.documentTypeFilter,
      placeholder: "All document types",
      valueSelector: (row) => row.document_type,
      sortMode: "alpha",
    },
    year: {
      element: elements.yearFilter,
      placeholder: "All years",
      valueSelector: (row) => row.year,
      sortMode: "year-desc",
    },
  };

  return configs[key];
}

function buildSelectOptions(selectElement, _placeholder, values) {
  selectElement.replaceChildren();

  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    selectElement.append(option);
  }
}

function getSelectedValues(selectElement) {
  return Array.from(selectElement.selectedOptions)
    .map((option) => option.value)
    .filter(Boolean);
}

function setSelectedValues(selectElement, selectedValues) {
  for (const option of selectElement.options) {
    option.selected = selectedValues.includes(option.value);
  }
}

function clearSelectSelection(selectElement) {
  for (const option of selectElement.options) {
    option.selected = false;
  }
}

function updateClearButtonState() {
  elements.clearFiltersButton.classList.toggle("is-active", hasActiveFilters());
}

function hasActiveFilters() {
  return Boolean(
    cleanText(state.filters.title) ||
      state.filters.theme.length ||
      state.filters.documentType.length ||
      state.filters.year.length
  );
}

function mergeOptionsWithSelected(options, selectedValues) {
  const merged = [...options];
  for (const value of selectedValues) {
    if (!merged.includes(value)) {
      merged.push(value);
    }
  }
  return merged;
}

function setOptionAvailability(selectElement, availableValues) {
  for (const option of selectElement.options) {
    const isUnavailable = !availableValues.has(option.value);
    option.dataset.unavailable = isUnavailable ? "true" : "false";
  }
}

function getUniqueValues(rows, valueSelector, sortMode) {
  const unique = [...new Set(rows.map(valueSelector).map(cleanText).filter(Boolean))];

  if (sortMode === "year-desc") {
    return unique.sort((a, b) => Number(b) - Number(a));
  }

  return unique.sort((a, b) => a.localeCompare(b));
}

function renderTable() {
  elements.tableBody.replaceChildren();

  if (state.filteredRows.length === 0) {
    elements.emptyState.hidden = false;
  } else {
    elements.emptyState.hidden = true;
  }

  for (const row of state.filteredRows) {
    const tableRow = document.createElement("tr");

    const titleCell = document.createElement("td");
    titleCell.append(createTitleNode(row.title, row.link));
    tableRow.append(titleCell);

    tableRow.append(createCell(row.theme || "-", !row.theme));
    tableRow.append(createCell(row.document_type || "-", !row.document_type));
    tableRow.append(createCell(row.year || "-", !row.year));

    elements.tableBody.append(tableRow);
  }

  elements.resultCount.textContent = `${state.filteredRows.length.toLocaleString()} results`;
}

function createTitleNode(title, link) {
  const displayTitle = title || "-";
  const titleQuery = cleanText(state.filters.title);

  if (link && /^https?:\/\//i.test(link)) {
    const anchor = document.createElement("a");
    anchor.className = "title-link";
    anchor.href = link;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    appendHighlightedText(anchor, displayTitle, titleQuery);
    return anchor;
  }

  const span = document.createElement("span");
  appendHighlightedText(span, displayTitle, titleQuery);
  if (!title) {
    span.className = "text-muted";
  }
  return span;
}

function appendHighlightedText(targetNode, fullText, query) {
  const search = cleanText(query);
  if (!search) {
    targetNode.textContent = fullText;
    return;
  }

  const titleLower = fullText.toLowerCase();
  const queryLower = search.toLowerCase();
  let cursor = 0;

  while (cursor < fullText.length) {
    const matchIndex = titleLower.indexOf(queryLower, cursor);
    if (matchIndex === -1) {
      targetNode.append(document.createTextNode(fullText.slice(cursor)));
      break;
    }

    if (matchIndex > cursor) {
      targetNode.append(document.createTextNode(fullText.slice(cursor, matchIndex)));
    }

    const highlight = document.createElement("mark");
    highlight.className = "title-highlight";
    highlight.textContent = fullText.slice(matchIndex, matchIndex + search.length);
    targetNode.append(highlight);

    cursor = matchIndex + search.length;
  }
}

function createCell(text, muted = false) {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (muted) {
    cell.className = "text-muted";
  }
  return cell;
}

function normalizeRow(row) {
  return {
    title: cleanText(row.title),
    theme: cleanText(row.theme),
    document_type: cleanText(row.document_type || row.document_type_title),
    year: cleanText(row.year),
    link: cleanText(row.link),
  };
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function parseCsv(text) {
  const records = [];
  let row = [];
  let field = "";
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === "\"") {
      const nextCharacter = text[index + 1];
      if (insideQuotes && nextCharacter === "\"") {
        field += "\"";
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (character === "," && !insideQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !insideQuotes) {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") {
        records.push(row);
      }
      row = [];
      continue;
    }

    field += character;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  if (records.length === 0) {
    return [];
  }

  const headers = records[0].map((header) => standardizeHeader(header));
  const dataRows = records.slice(1);

  return dataRows.map((fields) => {
    const object = {};
    for (let index = 0; index < headers.length; index += 1) {
      object[headers[index]] = fields[index] ?? "";
    }
    return object;
  });
}

function standardizeHeader(header) {
  const normalized = cleanText(header)
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");

  if (normalized === "document_type_title") {
    return "document_type_title";
  }
  return normalized;
}

function normalizeText(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesTitle(title, query) {
  const titleQuery = cleanText(query);
  if (!titleQuery) {
    return true;
  }

  const titleText = cleanText(title);
  if (!titleText) {
    return false;
  }

  return titleText.toLowerCase().includes(titleQuery.toLowerCase());
}

function isSubsequence(needle, haystack) {
  if (!needle) {
    return true;
  }

  let pointer = 0;
  for (const character of haystack) {
    if (character === needle[pointer]) {
      pointer += 1;
      if (pointer === needle.length) {
        return true;
      }
    }
  }
  return false;
}

function debounce(callback, waitMs) {
  let timeoutId = null;

  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => callback(...args), waitMs);
  };
}

function setStatus(message, isError = false) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.classList.toggle("error", isError);
}
