const fs = require("node:fs");
const path = require("node:path");

const inputCsvPath = path.resolve(process.cwd(), process.argv[2] || "output_llamacpp.csv");
const outputDirPath = path.resolve(process.cwd(), "database_html");
const outputHtmlPath = path.resolve(
  outputDirPath,
  process.argv[3] || "index.html"
);
const outputCssPath = path.resolve(outputDirPath, process.argv[4] || "index.css");

main();

function main() {
  if (!fs.existsSync(inputCsvPath)) {
    console.error(`Input CSV not found: ${inputCsvPath}`);
    process.exit(1);
  }

  const csvText = fs.readFileSync(inputCsvPath, "utf8");
  const rows = parseCsv(csvText)
    .map(normalizeRow)
    .filter((row) => row.title || row.theme || row.document_type || row.year);

  const rawHtml = buildStaticHtml(rows);
  const { html, css } = externalizeCss(rawHtml);

  fs.mkdirSync(outputDirPath, { recursive: true });
  fs.writeFileSync(outputHtmlPath, html, "utf8");
  fs.writeFileSync(outputCssPath, css, "utf8");

  console.log(`Generated ${outputHtmlPath}`);
  console.log(`Generated ${outputCssPath}`);
  console.log(`Rows embedded: ${rows.length.toLocaleString()}`);
}

function externalizeCss(htmlText) {
  const styleRegex = /<style>\s*([\s\S]*?)\s*<\/style>/;
  const styleMatch = htmlText.match(styleRegex);

  if (!styleMatch) {
    return { html: htmlText, css: "" };
  }

  const css = `${styleMatch[1].trim()}\n`;
  const htmlWithCssLink = htmlText.replace(
    styleRegex,
    '<link rel="stylesheet" href="./index.css" />'
  );
  const html = htmlWithCssLink.replace(/^\s*<p class="eyebrow">[\s\S]*?<\/p>\s*$/m, "");

  return { html, css };
}

function buildStaticHtml(rows) {
  const dataJson = safeJsonForScript(rows);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>BCSDA Database</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Sora:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
    <style>
      :root {
        --bg: #f2f7f5;
        --bg-accent: #eef6ff;
        --card: rgba(255, 255, 255, 0.9);
        --card-strong: #ffffff;
        --text: #102531;
        --text-muted: #4f6572;
        --line: #d4e2ec;
        --focus: #159a9c;
        --accent: #0f766e;
        --accent-soft: #d8f1ee;
        --warm: #cc7a29;
        --shadow: 0 14px 42px rgba(16, 37, 49, 0.1);
      }

      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        min-height: 100%;
      }

      body {
        font-family: "Sora", "Segoe UI", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at 6% 8%, #def1ff 0%, rgba(222, 241, 255, 0) 44%),
          radial-gradient(circle at 96% 0%, #fce8d6 0%, rgba(252, 232, 214, 0) 36%),
          linear-gradient(160deg, var(--bg), var(--bg-accent));
        padding: 28px 18px 44px;
      }

      .bg-orb {
        position: fixed;
        border-radius: 999px;
        pointer-events: none;
        z-index: -2;
        filter: blur(28px);
        opacity: 0.55;
      }

      .bg-orb-1 {
        width: 280px;
        height: 280px;
        top: -110px;
        right: 7%;
        background: #d4f7d2;
      }

      .bg-orb-2 {
        width: 360px;
        height: 360px;
        bottom: -140px;
        left: -90px;
        background: #cfe7ff;
      }

      .bg-grid {
        position: fixed;
        inset: 0;
        z-index: -3;
        pointer-events: none;
        background-image:
          linear-gradient(rgba(16, 37, 49, 0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(16, 37, 49, 0.04) 1px, transparent 1px);
        background-size: 36px 36px;
        mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.3), rgba(0, 0, 0, 0.04));
      }

      .page-shell {
        max-width: 1200px;
        margin: 0 auto;
      }

      .hero {
        animation: rise 520ms ease;
      }

      .eyebrow {
        margin: 0;
        font-size: 0.73rem;
        letter-spacing: 0.19em;
        text-transform: uppercase;
        color: var(--accent);
        font-weight: 600;
      }

      h1 {
        margin: 8px 0 0;
        font-family: "Fraunces", Georgia, serif;
        font-size: clamp(1.6rem, 2.3vw, 2.35rem);
        line-height: 1.15;
        letter-spacing: -0.015em;
      }

      .subtitle {
        margin: 10px 0 0;
        color: var(--text-muted);
        max-width: 740px;
      }

      .panel {
        margin-top: 20px;
        border: 1px solid rgba(212, 226, 236, 0.85);
        border-radius: 18px;
        background: var(--card);
        backdrop-filter: blur(8px);
        box-shadow: var(--shadow);
      }

      .filters-panel {
        padding: 18px 18px 14px;
      }

      .filters {
        display: grid;
        grid-template-columns: minmax(280px, 2.2fr) minmax(260px, 1.7fr) minmax(260px, 1.7fr) minmax(110px, 0.8fr);
        gap: 12px;
        align-items: start;
      }

      .filter-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .filter-group label {
        font-size: 0.83rem;
        font-weight: 600;
        color: var(--text-muted);
      }

      input[type="search"],
      select {
        width: 100%;
        border-radius: 12px;
        border: 1px solid var(--line);
        padding: 10px 12px;
        background: rgba(255, 255, 255, 0.93);
        font: inherit;
        color: var(--text);
        transition: border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease;
      }

      select[multiple] {
        min-height: 126px;
        padding-right: 6px;
      }

      select[multiple] option:checked {
        background: linear-gradient(#ffd6a6, #ffd6a6);
        color: #7a3600;
        font-weight: 600;
      }

      select[multiple] option[data-unavailable="true"]:checked {
        background: linear-gradient(#f5ddc1, #f5ddc1);
        color: #a07447;
        font-weight: 600;
      }

      input[type="search"]::placeholder {
        color: #8094a1;
      }

      input[type="search"]:focus,
      select:focus {
        outline: none;
        border-color: var(--focus);
        box-shadow: 0 0 0 4px rgba(21, 154, 156, 0.15);
        transform: translateY(-1px);
      }

      .filter-actions {
        display: flex;
        grid-column: 1 / -1;
      }

      .clear-btn {
        border: 1px solid #cbdbe5;
        border-radius: 12px;
        padding: 10px 14px;
        width: 100%;
        font: inherit;
        font-weight: 600;
        background: #fff;
        color: var(--text);
        cursor: pointer;
        transition: background-color 150ms ease, transform 150ms ease, border-color 150ms ease;
      }

      .clear-btn:hover {
        transform: translateY(-1px);
        border-color: #9db9c8;
        background: #f7fcff;
      }

      .clear-btn.is-active {
        border-color: #e5ab72;
        background: #fff2e3;
        box-shadow: 0 0 0 2px rgba(204, 122, 41, 0.15);
      }

      .meta-row {
        margin-top: 11px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .result-count {
        margin: 0;
        font-size: 0.88rem;
        color: #1b3341;
      }

      .table-panel {
        padding: 12px;
      }

      .table-wrap {
        position: relative;
        width: 100%;
        overflow: visible;
        border: 1px solid #dbe7ef;
        border-radius: 14px;
        background: var(--card-strong);
      }

      table {
        width: 100%;
        border-collapse: collapse;
        min-width: 740px;
      }

      thead th {
        text-align: left;
        font-size: 0.8rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: #325065;
        background: linear-gradient(180deg, #f5fbff, #eef7fd);
        position: sticky;
        top: 0;
        z-index: 1;
      }

      th,
      td {
        padding: 12px 14px;
        border-bottom: 1px solid #e7eff5;
        vertical-align: top;
      }

      tbody tr {
        transition: background-color 130ms ease;
      }

      tbody tr:hover {
        background: #f8fcff;
      }

      tbody tr:last-child td {
        border-bottom: 0;
      }

      .title-link {
        color: #0d4f6f;
        text-decoration-color: #9bcbe6;
        text-decoration-thickness: 1.5px;
        text-underline-offset: 3px;
        font-weight: 500;
        transition: color 120ms ease, text-decoration-color 120ms ease;
      }

      .title-link:hover {
        color: #0b2f44;
        text-decoration-color: #0b6a9a;
      }

      .title-highlight {
        background: #ffe2bf;
        color: #ad410f;
        border-radius: 4px;
        padding: 0 2px;
      }

      .title-link::after {
        content: " ↗";
        color: var(--warm);
        font-weight: 700;
      }

      .title-cell-wrap {
        position: static;
        display: inline;
      }

      .summary-bubble {
        display: none;
        position: absolute;
        left: 12px;
        right: 12px;
        z-index: 10;
        margin-top: 4px;
        padding: 14px 18px;
        font-size: 0.8rem;
        line-height: 1.6;
        color: #1b3341;
        background: #fff6ec;
        border: 1px solid #f0d4ad;
        border-radius: 10px;
        box-shadow: 0 8px 28px rgba(16, 37, 49, 0.13);
        white-space: normal;
        word-wrap: break-word;
        pointer-events: none;
      }

      .summary-bubble b {
        font-weight: 700;
        color: #102531;
      }

      .title-cell-wrap:hover .summary-bubble {
        display: block;
      }

      .text-muted {
        color: #7b8f9b;
      }

      .empty-state {
        margin: 18px auto 6px;
        max-width: 520px;
        border: 1px dashed #cbdee9;
        border-radius: 14px;
        padding: 22px;
        text-align: center;
        background:
          radial-gradient(circle at top, rgba(233, 247, 255, 0.85), rgba(255, 255, 255, 0.95)),
          #fff;
      }

      .empty-state h2 {
        margin: 0;
        font-family: "Fraunces", Georgia, serif;
        font-size: 1.2rem;
      }

      .empty-state p {
        margin: 7px 0 0;
        color: var(--text-muted);
        font-size: 0.94rem;
      }

      @keyframes rise {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @media (max-width: 1024px) {
        .filters {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .filter-title,
        .filter-actions {
          grid-column: 1 / -1;
        }
      }

      @media (max-width: 640px) {
        body {
          padding: 18px 12px 30px;
        }

        .panel {
          border-radius: 14px;
        }

        .filters {
          grid-template-columns: 1fr;
        }

        .meta-row {
          flex-direction: column;
          align-items: flex-start;
        }
      }
    </style>
  </head>
  <body>
    <div class="bg-orb bg-orb-1" aria-hidden="true"></div>
    <div class="bg-orb bg-orb-2" aria-hidden="true"></div>
    <div class="bg-grid" aria-hidden="true"></div>

    <main class="page-shell">
      <header class="hero">
        <h1>BCSDA Global-Network Resources Database</h1>
        <p class="subtitle">
          Last Update 29/03/2026
        </p>
      </header>

      <section class="panel filters-panel">
        <form id="filters-form" class="filters" autocomplete="off">
          <div class="filter-group filter-title">
            <label for="title-filter">Title</label>
            <input
              id="title-filter"
              type="search"
              placeholder="Search by title (exact text match, case-insensitive)"
            />
          </div>

          <div class="filter-group">
            <label for="theme-filter">Theme</label>
            <select id="theme-filter" multiple size="6">
              <option value="">All themes</option>
            </select>
          </div>

          <div class="filter-group">
            <label for="document-type-filter">Document Type</label>
            <select id="document-type-filter" multiple size="6">
              <option value="">All document types</option>
            </select>
          </div>

          <div class="filter-group">
            <label for="year-filter">Year</label>
            <select id="year-filter" multiple size="6">
              <option value="">All years</option>
            </select>
          </div>

          <div class="filter-actions">
            <button id="clear-filters" type="button" class="clear-btn">Clear Filters</button>
          </div>
        </form>

        <div class="meta-row">
          <p id="result-count" class="result-count">0 results</p>
        </div>
      </section>

      <section class="panel table-panel">
        <div class="table-wrap">
          <table aria-label="BCSDA resources table">
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Theme</th>
                <th scope="col">Document Type</th>
                <th scope="col">Year</th>
              </tr>
            </thead>
            <tbody id="resources-tbody"></tbody>
          </table>
        </div>

        <div id="empty-state" class="empty-state" hidden>
          <h2>No matching resources</h2>
          <p>Try broadening your search terms or clearing one of the selected filters.</p>
        </div>
      </section>
    </main>

    <script id="seed-data" type="application/json">${dataJson}</script>
    <script>
      (function () {
        const seedDataElement = document.getElementById("seed-data");
        const allRows = JSON.parse(seedDataElement.textContent || "[]");

        const state = {
          allRows: allRows,
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
          tableBody: document.getElementById("resources-tbody"),
          emptyState: document.getElementById("empty-state"),
        };

        bindEvents();
        runFilterPipeline();

        function bindEvents() {
          elements.titleFilter.addEventListener(
            "input",
            debounce(function () {
              state.filters.title = elements.titleFilter.value.trim();
              runFilterPipeline();
            }, 120)
          );

          const handleThemeChange = function () {
            state.filters.theme = getSelectedValues(elements.themeFilter);
            runFilterPipeline();
          };
          const ignoreThemeChange = enableClickToggleMultiSelect(
            elements.themeFilter,
            handleThemeChange
          );
          elements.themeFilter.addEventListener("change", function () {
            if (ignoreThemeChange()) {
              return;
            }
            handleThemeChange();
          });

          const handleDocumentTypeChange = function () {
            state.filters.documentType = getSelectedValues(elements.documentTypeFilter);
            runFilterPipeline();
          };
          const ignoreDocumentTypeChange = enableClickToggleMultiSelect(
            elements.documentTypeFilter,
            handleDocumentTypeChange
          );
          elements.documentTypeFilter.addEventListener("change", function () {
            if (ignoreDocumentTypeChange()) {
              return;
            }
            handleDocumentTypeChange();
          });

          const handleYearChange = function () {
            state.filters.year = getSelectedValues(elements.yearFilter);
            runFilterPipeline();
          };
          const ignoreYearChange = enableClickToggleMultiSelect(
            elements.yearFilter,
            handleYearChange
          );
          elements.yearFilter.addEventListener("change", function () {
            if (ignoreYearChange()) {
              return;
            }
            handleYearChange();
          });

          elements.clearFiltersButton.addEventListener("click", function () {
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

          selectElement.addEventListener("mousedown", function (event) {
            const option = event.target;
            if (!option || option.tagName !== "OPTION") {
              return;
            }

            event.preventDefault();
            option.selected = !option.selected;
            ignoreNextChange = true;
            onSelectionChanged();
          });

          selectElement.addEventListener("click", function (event) {
            if (event.target && event.target.tagName === "OPTION") {
              event.preventDefault();
            }
          });

          return function () {
            if (!ignoreNextChange) {
              return false;
            }
            ignoreNextChange = false;
            return true;
          };
        }

        function runFilterPipeline() {
          updateRelationalDropdowns();
          applyFilters();
          renderTable();
          updateClearButtonState();
        }

        function applyFilters() {
          const titleQuery = cleanText(state.filters.title);

          state.filteredRows = state.allRows.filter(function (row) {
            if (titleQuery && !matchesTitle(row.title, titleQuery)) {
              return false;
            }
            if (state.filters.theme.length && state.filters.theme.indexOf(row.theme) === -1) {
              return false;
            }
            if (
              state.filters.documentType.length &&
              state.filters.documentType.indexOf(row.document_type) === -1
            ) {
              return false;
            }
            if (state.filters.year.length && state.filters.year.indexOf(row.year) === -1) {
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
          const rows = state.allRows.filter(function (row) {
            return matchesAllFiltersExcept(row, key, filterSnapshot);
          });
          const availableOptions = getUniqueValues(rows, config.valueSelector, config.sortMode);

          const persistedValues = Array.from(
            new Set(
              filterSnapshot[key]
                .map(function (value) {
                  return cleanText(value);
                })
                .filter(Boolean)
            )
          );
          const displayOptions = mergeOptionsWithSelected(availableOptions, persistedValues);
          buildSelectOptions(config.element, config.placeholder, displayOptions);

          state.filters[key] = persistedValues;
          setSelectedValues(config.element, persistedValues);
          setOptionAvailability(config.element, new Set(availableOptions));
        }

        function matchesAllFiltersExcept(row, excludedKey, filters) {
          const activeFilters = filters || state.filters;
          const titleQuery = cleanText(activeFilters.title);

          if (excludedKey !== "title" && titleQuery && !matchesTitle(row.title, titleQuery)) {
            return false;
          }
          if (
            excludedKey !== "theme" &&
            activeFilters.theme.length &&
            activeFilters.theme.indexOf(row.theme) === -1
          ) {
            return false;
          }
          if (
            excludedKey !== "documentType" &&
            activeFilters.documentType.length &&
            activeFilters.documentType.indexOf(row.document_type) === -1
          ) {
            return false;
          }
          if (
            excludedKey !== "year" &&
            activeFilters.year.length &&
            activeFilters.year.indexOf(row.year) === -1
          ) {
            return false;
          }
          return true;
        }

        function getFilterSnapshot() {
          return {
            title: state.filters.title,
            theme: state.filters.theme.slice(),
            documentType: state.filters.documentType.slice(),
            year: state.filters.year.slice(),
          };
        }

        function getDropdownConfig(key) {
          const configMap = {
            theme: {
              element: elements.themeFilter,
              placeholder: "All themes",
              valueSelector: function (row) {
                return row.theme;
              },
              sortMode: "alpha",
            },
            documentType: {
              element: elements.documentTypeFilter,
              placeholder: "All document types",
              valueSelector: function (row) {
                return row.document_type;
              },
              sortMode: "alpha",
            },
            year: {
              element: elements.yearFilter,
              placeholder: "All years",
              valueSelector: function (row) {
                return row.year;
              },
              sortMode: "year-desc",
            },
          };

          return configMap[key];
        }

        function buildSelectOptions(selectElement, _placeholder, values) {
          while (selectElement.firstChild) {
            selectElement.removeChild(selectElement.firstChild);
          }

          values.forEach(function (value) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            selectElement.appendChild(option);
          });
        }

        function getSelectedValues(selectElement) {
          return Array.from(selectElement.selectedOptions)
            .map(function (option) {
              return option.value;
            })
            .filter(Boolean);
        }

        function setSelectedValues(selectElement, selectedValues) {
          Array.from(selectElement.options).forEach(function (option) {
            option.selected = selectedValues.indexOf(option.value) !== -1;
          });
        }

        function clearSelectSelection(selectElement) {
          Array.from(selectElement.options).forEach(function (option) {
            option.selected = false;
          });
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
          const merged = options.slice();
          selectedValues.forEach(function (value) {
            if (merged.indexOf(value) === -1) {
              merged.push(value);
            }
          });
          return merged;
        }

        function setOptionAvailability(selectElement, availableValues) {
          Array.from(selectElement.options).forEach(function (option) {
            const isUnavailable = !availableValues.has(option.value);
            option.dataset.unavailable = isUnavailable ? "true" : "false";
          });
        }

        function getUniqueValues(rows, valueSelector, sortMode) {
          const uniqueMap = new Map();

          rows.forEach(function (row) {
            const value = cleanText(valueSelector(row));
            if (value) {
              uniqueMap.set(value, true);
            }
          });

          const uniqueValues = Array.from(uniqueMap.keys());
          if (sortMode === "year-desc") {
            uniqueValues.sort(function (a, b) {
              return Number(b) - Number(a);
            });
            return uniqueValues;
          }

          uniqueValues.sort(function (a, b) {
            return a.localeCompare(b);
          });
          return uniqueValues;
        }

        function renderTable() {
          while (elements.tableBody.firstChild) {
            elements.tableBody.removeChild(elements.tableBody.firstChild);
          }

          if (state.filteredRows.length === 0) {
            elements.emptyState.hidden = false;
          } else {
            elements.emptyState.hidden = true;
          }

          state.filteredRows.forEach(function (row) {
            const tableRow = document.createElement("tr");

            const titleCell = document.createElement("td");
            titleCell.appendChild(createTitleNode(row.title, row.link, row.summary));
            tableRow.appendChild(titleCell);

            tableRow.appendChild(createCell(row.theme || "-", !row.theme));
            tableRow.appendChild(createCell(row.document_type || "-", !row.document_type));
            tableRow.appendChild(createCell(row.year || "-", !row.year));

            elements.tableBody.appendChild(tableRow);
          });

          elements.resultCount.textContent =
            state.filteredRows.length.toLocaleString() + " results";
        }

        function createTitleNode(title, link, summary) {
          const displayTitle = title || "-";
          const titleQuery = cleanText(state.filters.title);

          var titleElement;
          if (link && /^https?:\\/\\//i.test(link)) {
            titleElement = document.createElement("a");
            titleElement.className = "title-link";
            titleElement.href = link;
            titleElement.target = "_blank";
            titleElement.rel = "noopener noreferrer";
            appendHighlightedText(titleElement, displayTitle, titleQuery);
          } else {
            titleElement = document.createElement("span");
            appendHighlightedText(titleElement, displayTitle, titleQuery);
            if (!title) {
              titleElement.className = "text-muted";
            }
          }

          if (summary) {
            var wrapper = document.createElement("span");
            wrapper.className = "title-cell-wrap";
            wrapper.appendChild(titleElement);
            var bubble = document.createElement("span");
            bubble.className = "summary-bubble";
            bubble.innerHTML = summary
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/\\*\\*(.*?)\\*\\*/g, "<b>$1</b>");
            wrapper.appendChild(bubble);
            return wrapper;
          }

          return titleElement;
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
              targetNode.appendChild(document.createTextNode(fullText.slice(cursor)));
              break;
            }

            if (matchIndex > cursor) {
              targetNode.appendChild(
                document.createTextNode(fullText.slice(cursor, matchIndex))
              );
            }

            const highlight = document.createElement("mark");
            highlight.className = "title-highlight";
            highlight.textContent = fullText.slice(matchIndex, matchIndex + search.length);
            targetNode.appendChild(highlight);

            cursor = matchIndex + search.length;
          }
        }

        function createCell(text, muted) {
          const cell = document.createElement("td");
          cell.textContent = text;
          if (muted) {
            cell.className = "text-muted";
          }
          return cell;
        }

        function cleanText(value) {
          return String(value || "").trim();
        }

        function normalizeText(text) {
          return String(text || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\\u0300-\\u036f]/g, "")
            .replace(/[^a-z0-9\\s]/g, " ")
            .replace(/\\s+/g, " ")
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

          return titleText.toLowerCase().indexOf(titleQuery.toLowerCase()) !== -1;
        }

        function isSubsequence(needle, haystack) {
          if (!needle) {
            return true;
          }

          let pointer = 0;
          for (let index = 0; index < haystack.length; index += 1) {
            if (haystack[index] === needle[pointer]) {
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
          return function () {
            const args = arguments;
            clearTimeout(timeoutId);
            timeoutId = setTimeout(function () {
              callback.apply(null, args);
            }, waitMs);
          };
        }
      })();
    </script>
  </body>
</html>
`;
}

function safeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function normalizeRow(row) {
  return {
    title: cleanText(row.title),
    theme: cleanText(row.theme),
    document_type: cleanText(
      row.document_type || row.document_type_title || row.documenttype || row.document_type__title
    ),
    year: cleanText(row.year),
    link: cleanText(row.link),
    summary: cleanText(row.summary),
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
  return cleanText(header)
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}
