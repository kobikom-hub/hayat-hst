const axios = require('axios');

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  Accept: '*/*'
};

function buildUrl(baseUrl, pathname, query = {}) {
  const url = new URL(pathname, `${baseUrl}/`);

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    url.searchParams.set(key, String(value));
  });

  return url.toString();
}

function mergeCookies(existingCookies, setCookieHeaders = []) {
  const cookieMap = new Map(existingCookies.map((cookie) => [cookie.name, cookie]));

  setCookieHeaders.forEach((header) => {
    const [cookiePair] = header.split(';');
    const separatorIndex = cookiePair.indexOf('=');

    if (separatorIndex === -1) {
      return;
    }

    const name = cookiePair.slice(0, separatorIndex).trim();
    const value = cookiePair.slice(separatorIndex + 1).trim();

    if (!name) {
      return;
    }

    cookieMap.set(name, {
      name,
      value
    });
  });

  return Array.from(cookieMap.values());
}

function serializeCookies(cookies) {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

async function hospitalRequest(session, config) {
  const response = await axios({
    method: config.method || 'GET',
    url: buildUrl(config.baseUrl, config.path, config.query),
    data: config.data || undefined,
    headers: {
      ...DEFAULT_HEADERS,
      Cookie: session.cookieHeader,
      ...(config.headers || {})
    },
    responseType: config.responseType || 'text',
    maxRedirects: 10,
    timeout: config.timeoutMs || 30_000,
    validateStatus: () => true
  });

  const setCookieHeaders = response.headers['set-cookie'];

  if (Array.isArray(setCookieHeaders) && setCookieHeaders.length > 0) {
    session.cookies = mergeCookies(session.cookies || [], setCookieHeaders);
    session.cookieHeader = serializeCookies(session.cookies);

    const phpSessionCookie = session.cookies.find((cookie) => cookie.name === 'PHPSESSID');
    if (phpSessionCookie) {
      session.phpsessid = phpSessionCookie.value;
    }
  }

  session.lastUsedAt = Date.now();
  return response;
}

async function setVariables(session, { baseUrl, vars, vals }) {
  return hospitalRequest(session, {
    baseUrl,
    path: '/set_variables.php',
    query: {
      vars,
      vals
    }
  });
}

async function selectHospital(session, { baseUrl, hospitalId }) {
  await setVariables(session, {
    baseUrl,
    vars: 'choice',
    vals: 'new_appointment.php'
  });

  await setVariables(session, {
    baseUrl,
    vars: 'off_id',
    vals: hospitalId
  });
}

module.exports = {
  buildUrl,
  hospitalRequest,
  selectHospital,
  serializeCookies,
  setVariables
};
