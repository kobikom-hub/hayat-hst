const { chromium } = require('playwright');

const sessions = new Map();
const pendingSessions = new Map();

function isExpired(session, sessionTtlMs) {
  return Date.now() - session.lastUsedAt > sessionTtlMs;
}

function serializeCookies(cookies) {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

async function closeSession(session) {
  const closeSafely = async (resource, methodName) => {
    if (!resource || typeof resource[methodName] !== 'function') {
      return;
    }

    try {
      await resource[methodName]();
    } catch (error) {
      console.error(`Failed to close ${methodName}:`, error.message);
    }
  };

  await closeSafely(session.page, 'close');
  await closeSafely(session.context, 'close');
  await closeSafely(session.browser, 'close');
}

async function refreshSessionCookies(session) {
  const cookies = await session.context.cookies();
  session.cookies = cookies;
  session.cookieHeader = serializeCookies(cookies);
  const phpSession = cookies.find((cookie) => cookie.name === 'PHPSESSID');
  session.phpsessid = phpSession ? phpSession.value : null;
}

async function createBrowserSession(baseUrl) {
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(baseUrl, {
    waitUntil: 'domcontentloaded'
  });

  await page.waitForLoadState('networkidle', {
    timeout: 15000
  }).catch(() => {
    // Some legacy pages keep the network busy. The initial cookies are usually
    // available after DOMContentLoaded, so this timeout is safe to ignore.
  });

  const cookies = await context.cookies();
  const phpSession = cookies.find((cookie) => cookie.name === 'PHPSESSID');

  if (!phpSession) {
    await browser.close();
    throw new Error('PHPSESSID not found while creating browser session');
  }

  return {
    browser,
    context,
    page,
    cookies,
    cookieHeader: serializeCookies(cookies),
    phpsessid: phpSession.value,
    createdAt: Date.now(),
    lastUsedAt: Date.now()
  };
}

async function getOrCreateSession(conversationId, { baseUrl, sessionTtlMs }) {
  const existingSession = sessions.get(conversationId);

  if (existingSession && !isExpired(existingSession, sessionTtlMs)) {
    existingSession.lastUsedAt = Date.now();
    return existingSession;
  }

  if (existingSession) {
    sessions.delete(conversationId);
    await closeSession(existingSession);
  }

  if (pendingSessions.has(conversationId)) {
    return pendingSessions.get(conversationId);
  }

  const sessionPromise = createBrowserSession(baseUrl)
    .then((session) => {
      sessions.set(conversationId, session);
      return session;
    })
    .finally(() => {
      pendingSessions.delete(conversationId);
    });

  pendingSessions.set(conversationId, sessionPromise);
  return sessionPromise;
}

async function destroySession(conversationId) {
  const session = sessions.get(conversationId);
  sessions.delete(conversationId);

  if (session) {
    await closeSession(session);
  }
}

async function destroyAllSessions() {
  const conversationIds = Array.from(sessions.keys());
  await Promise.all(conversationIds.map((conversationId) => destroySession(conversationId)));
}

async function cleanupExpiredSessions(sessionTtlMs) {
  const expiredConversationIds = [];

  for (const [conversationId, session] of sessions.entries()) {
    if (isExpired(session, sessionTtlMs)) {
      expiredConversationIds.push(conversationId);
    }
  }

  await Promise.all(expiredConversationIds.map((conversationId) => destroySession(conversationId)));
}

function startSessionCleanup(sessionTtlMs) {
  const interval = setInterval(() => {
    cleanupExpiredSessions(sessionTtlMs).catch((error) => {
      console.error('Failed to cleanup expired sessions:', error.message);
    });
  }, Math.max(60_000, Math.floor(sessionTtlMs / 2)));

  interval.unref();
  return interval;
}

module.exports = {
  destroyAllSessions,
  destroySession,
  getOrCreateSession,
  refreshSessionCookies,
  serializeCookies,
  startSessionCleanup
};
