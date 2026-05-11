function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(html) {
  return decodeHtmlEntities(String(html))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tryParseJson(raw) {
  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    return null;
  }
}

function extractOptions(html) {
  const options = [];
  const optionRegex = /<option\b[^>]*value=["']?([^"'>]*)["']?[^>]*>([\s\S]*?)<\/option>/gi;
  let match;

  while ((match = optionRegex.exec(String(html))) !== null) {
    const value = decodeHtmlEntities(match[1]).trim();
    const label = stripHtml(match[2]);

    if (!label) {
      continue;
    }

    options.push({ value, label });
  }

  return options;
}

function extractHiddenInputs(html) {
  const values = {};
  const inputRegex = /<input\b[^>]*type=["']hidden["'][^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["'][^>]*>/gi;
  let match;

  while ((match = inputRegex.exec(String(html))) !== null) {
    values[match[1]] = decodeHtmlEntities(match[2]).trim();
  }

  return values;
}

function parseKeyValueRows(html) {
  const rows = {};
  const rowRegex = /<tr\b[^>]*>\s*<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>\s*<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>\s*<\/tr>/gi;
  let match;

  while ((match = rowRegex.exec(String(html))) !== null) {
    const key = stripHtml(match[1]).replace(/:$/, '').trim();
    const value = stripHtml(match[2]);

    if (key && value) {
      rows[key] = value;
    }
  }

  return rows;
}

function normalizeStructuredData(raw) {
  if (typeof raw !== 'string') {
    return raw;
  }

  const parsedJson = tryParseJson(raw);
  if (parsedJson !== null) {
    return parsedJson;
  }

  const options = extractOptions(raw);
  if (options.length > 0) {
    return options;
  }

  return raw.trim();
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseAppointmentTimeRows(rows) {
  let currentDay = null;

  return rows
    .map((row) => {
      if (row.day) {
        currentDay = stripHtml(row.day);
      }

      return {
        day: currentDay,
        label: row.time || '',
        time: row.time || '',
        aop_id: numberOrNull(row.aop_id),
        app_type: numberOrNull(row.app_type)
      };
    })
    .filter((row) => row.time || row.aop_id !== null);
}

function parseAppointmentTimeResponse(raw) {
  const normalized = normalizeStructuredData(raw);

  if (Array.isArray(normalized)) {
    return normalized.map((item) => {
      const source = item.label || '';
      const aopIdMatch = source.match(/aop_id['":= ]+(\d+)/i);
      const appTypeMatch = source.match(/app_type['":= ]+(\d+)/i);

      return {
        ...item,
        aop_id: aopIdMatch ? Number(aopIdMatch[1]) : null,
        app_type: appTypeMatch ? Number(appTypeMatch[1]) : null
      };
    });
  }

  if (normalized && typeof normalized === 'object' && Array.isArray(normalized.Rows)) {
    return parseAppointmentTimeRows(normalized.Rows);
  }

  if (typeof normalized !== 'string') {
    return normalized;
  }

  const rows = [];
  const anchorRegex = /<a\b[^>]*onclick=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRegex.exec(normalized)) !== null) {
    const onclick = decodeHtmlEntities(match[1]);
    const label = stripHtml(match[2]);
    const aopIdMatch = onclick.match(/aop_id[^0-9]*(\d+)/i) || onclick.match(/(?:^|,)\s*(\d+)\s*,/);
    const appTypeMatch = onclick.match(/app_type[^0-9]*(\d+)/i) || onclick.match(/,\s*(\d+)\s*\)?$/);

    rows.push({
      label,
      aop_id: aopIdMatch ? Number(aopIdMatch[1]) : null,
      app_type: appTypeMatch ? Number(appTypeMatch[1]) : null
    });
  }

  return rows.length > 0 ? rows : normalized;
}

function parseAppointmentApprove(html) {
  const rows = parseKeyValueRows(html);
  const hiddenInputs = extractHiddenInputs(html);
  const text = stripHtml(html);

  const summary = {
    doctor: rows.Doktor || rows.Hekim || null,
    department: rows.Brans || rows.Branch || rows.Bolum || null,
    date: rows.Tarih || null,
    time: rows.Saat || null,
    center: rows.Merkez || rows.Kurum || null
  };

  return {
    summary,
    hidden_fields: hiddenInputs,
    text
  };
}

function parseAppointmentCode(raw) {
  const normalized = normalizeStructuredData(raw);

  if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
    const appCode = normalized.app_code || normalized.appCode || normalized.randevu_kodu || null;
    return {
      app_code: appCode,
      raw: normalized
    };
  }

  const text = stripHtml(String(raw));
  const match = text.match(/(?:app[_ ]?code|randevu kodu)[:\s#-]*([A-Z0-9]+)/i);

  return {
    app_code: match ? match[1] : null,
    raw: normalized
  };
}

module.exports = {
  decodeHtmlEntities,
  extractOptions,
  normalizeStructuredData,
  parseAppointmentApprove,
  parseAppointmentCode,
  parseAppointmentTimeResponse,
  stripHtml,
  tryParseJson
};
