// Shared OpenAI model compatibility helpers for Responses API requests.

const SUPPORTED_REASONING_MODES = new Set(['auto', 'always', 'never']);
const SUPPORTED_MODEL_SERIES = new Set(['gpt-4', 'gpt-5']);
const SUPPORTED_TEXT_VERBOSITY = new Set(['low', 'medium', 'high']);
const SUPPORTED_REASONING_SUMMARY = new Set(['auto', 'concise', 'detailed']);

function normalizeModelName(model) {
  const normalized = String(model || '').trim().toLowerCase();
  if (!normalized) return '';
  const parts = normalized.split('/');
  return parts[parts.length - 1];
}

function normalizeModelSeries(series) {
  const normalized = String(series || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'gpt4' || normalized === 'gpt-4') return 'gpt-4';
  if (normalized === 'gpt5' || normalized === 'gpt-5') return 'gpt-5';
  return '';
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseInteger(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function parseBoundedFloat(value, min, max) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < min || parsed > max) return null;
  return parsed;
}

function resolveSeriesOverride(env, baseKey, seriesSuffix) {
  if (!seriesSuffix) return env[baseKey];
  const seriesKey = `${baseKey}_${seriesSuffix}`;
  const seriesValue = env[seriesKey];
  if (seriesValue !== undefined && String(seriesValue).trim() !== '') {
    return seriesValue;
  }
  return env[baseKey];
}

export function modelSupportsReasoning(model) {
  const normalized = normalizeModelName(model);
  return normalized.startsWith('gpt-5') || /^o\d/.test(normalized);
}

export function resolveModelConfig(env = process.env) {
  const requestedModel = String(env.OPENAI_MODEL || '').trim();
  const requestedSeries = normalizeModelSeries(env.OPENAI_MODEL_SERIES);

  const gpt4Model = String(env.OPENAI_MODEL_GPT4 || '').trim() || 'gpt-4o-mini';
  const gpt5Model = String(env.OPENAI_MODEL_GPT5 || '').trim() || 'gpt-5-mini';

  let model = 'gpt-4o-mini';
  if (SUPPORTED_MODEL_SERIES.has(requestedSeries)) {
    model = requestedSeries === 'gpt-5' ? gpt5Model : gpt4Model;
  } else if (requestedModel) {
    model = requestedModel;
  }
  const normalizedModel = normalizeModelName(model);
  const isGpt5Model = normalizedModel.startsWith('gpt-5');
  const isGpt4Model = normalizedModel.startsWith('gpt-4');
  const activeSeriesSuffix = isGpt5Model ? 'GPT5' : isGpt4Model ? 'GPT4' : '';
  const getSeriesValue = (baseKey) => resolveSeriesOverride(env, baseKey, activeSeriesSuffix);

  const requestedReasoningMode = String(getSeriesValue('OPENAI_REASONING_MODE') || 'auto')
    .trim()
    .toLowerCase();
  const reasoningMode = SUPPORTED_REASONING_MODES.has(requestedReasoningMode)
    ? requestedReasoningMode
    : 'auto';

  const reasoningEffort = String(getSeriesValue('OPENAI_REASONING_EFFORT') || 'low')
    .trim()
    .toLowerCase() || 'low';

  const reasoningEnabled = reasoningMode === 'always'
    ? true
    : reasoningMode === 'never'
      ? false
      : modelSupportsReasoning(model);

  const requestedReasoningSummary = String(getSeriesValue('OPENAI_REASONING_SUMMARY') || '')
    .trim()
    .toLowerCase();
  const reasoningSummary = reasoningEnabled && SUPPORTED_REASONING_SUMMARY.has(requestedReasoningSummary)
    ? requestedReasoningSummary
    : null;

  const determinismSeed = parseInteger(getSeriesValue('OPENAI_DETERMINISM_SEED'));
  const requestedTemperature = parseBoundedFloat(getSeriesValue('OPENAI_TEMPERATURE'), 0, 2);
  const requestedTopP = parseBoundedFloat(getSeriesValue('OPENAI_TOP_P'), 0, 1);
  const requestedLogprobs = parsePositiveInteger(getSeriesValue('OPENAI_LOGPROBS'));

  const gpt5SamplingCompatible = !isGpt5Model || (reasoningEnabled && reasoningEffort === 'none');
  const temperature = gpt5SamplingCompatible ? requestedTemperature : null;
  const topP = gpt5SamplingCompatible ? requestedTopP : null;
  const logprobs = gpt5SamplingCompatible ? requestedLogprobs : null;

  const warnings = [];
  if (
    isGpt5Model &&
    !gpt5SamplingCompatible &&
    (requestedTemperature !== null || requestedTopP !== null || requestedLogprobs !== null)
  ) {
    warnings.push(
      'OPENAI_TEMPERATURE/OPENAI_TOP_P/OPENAI_LOGPROBS were ignored for GPT-5 because they require OPENAI_REASONING_EFFORT=none.'
    );
  }

  const requestedTextVerbosity = String(getSeriesValue('OPENAI_TEXT_VERBOSITY') || '')
    .trim()
    .toLowerCase();
  const textVerbosity = isGpt5Model && SUPPORTED_TEXT_VERBOSITY.has(requestedTextVerbosity)
    ? requestedTextVerbosity
    : null;

  const globalMaxOutputTokens = parsePositiveInteger(env.OPENAI_MAX_OUTPUT_TOKENS);
  const seriesMaxOutputTokens = parsePositiveInteger(getSeriesValue('OPENAI_MAX_OUTPUT_TOKENS'));
  const maxOutputTokens = seriesMaxOutputTokens ?? globalMaxOutputTokens;
  const globalConcurrency = parsePositiveInteger(env.OPENAI_CONCURRENCY);
  const seriesConcurrency = parsePositiveInteger(getSeriesValue('OPENAI_CONCURRENCY'));
  const concurrency = seriesConcurrency ?? globalConcurrency ?? 20;

  return {
    model,
    reasoningMode,
    reasoningEffort,
    reasoningEnabled,
    requestedSeries,
    textVerbosity,
    maxOutputTokens,
    reasoningSummary,
    determinismSeed,
    temperature,
    topP,
    logprobs,
    warnings,
    concurrency,
  };
}

export function buildResponsesCreateParams({ modelConfig, input, maxOutputTokens }) {
  const request = {
    model: modelConfig.model,
    input,
  };

  const resolvedMaxOutputTokens = typeof maxOutputTokens === 'number'
    ? maxOutputTokens
    : modelConfig.maxOutputTokens;
  if (typeof resolvedMaxOutputTokens === 'number') {
    request.max_output_tokens = resolvedMaxOutputTokens;
  }

  if (modelConfig.reasoningEnabled) {
    request.reasoning = { effort: modelConfig.reasoningEffort };
    if (modelConfig.reasoningSummary) {
      request.reasoning.summary = modelConfig.reasoningSummary;
    }
  }
  if (modelConfig.textVerbosity) {
    request.text = { verbosity: modelConfig.textVerbosity };
  }
  if (modelConfig.determinismSeed !== null) {
    request.seed = modelConfig.determinismSeed;
  }
  if (modelConfig.temperature !== null) {
    request.temperature = modelConfig.temperature;
  }
  if (modelConfig.topP !== null) {
    request.top_p = modelConfig.topP;
  }
  if (modelConfig.logprobs !== null) {
    request.logprobs = modelConfig.logprobs;
  }

  return request;
}
