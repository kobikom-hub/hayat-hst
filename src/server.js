require('dotenv').config();

const express = require('express');

const { runAction } = require('./actions');
const {
  destroyAllSessions,
  destroySession,
  getOrCreateSession,
  startSessionCleanup
} = require('./sessionStore');
const { terminateCaptchaWorker } = require('./captchaSolver');

const app = express();

const config = {
  port: Number(process.env.PORT || 3000),
  baseUrl: process.env.BASE_URL || 'https://randevu.ozelhayathastanesi.com.tr',
  proxyToken: process.env.PROXY_TOKEN || 'CHANGE_THIS_TOKEN',
  sessionTtlMs: Number(process.env.SESSION_TTL_MS || 30 * 60 * 1000),
  captchaMaxAttempts: Number(process.env.CAPTCHA_MAX_ATTEMPTS || 3)
};

app.use(express.json({
  limit: '10mb'
}));

function auth(req, res, next) {
  const token = req.headers['x-proxy-token'];

  if (token !== config.proxyToken) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized'
    });
  }

  return next();
}

app.use(auth);

app.post('/', async (req, res) => {
  const action = req.body && req.body.action;
  const conversationId = req.body && req.body.conversation_id;

  if (!action) {
    return res.status(400).json({
      success: false,
      message: 'Missing action'
    });
  }

  if (!conversationId) {
    return res.status(400).json({
      success: false,
      message: 'Missing conversation_id'
    });
  }

  try {
    const session = await getOrCreateSession(conversationId, {
      baseUrl: config.baseUrl,
      sessionTtlMs: config.sessionTtlMs
    });

    const data = await runAction(action, session, req.body, config);

    return res.json({
      success: true,
      action,
      conversation_id: conversationId,
      data
    });
  } catch (error) {
    console.error(`[${action}]`, error.message);

    return res.status(500).json({
      success: false,
      action,
      conversation_id: conversationId,
      message: error.message
    });
  }
});

const cleanupInterval = startSessionCleanup(config.sessionTtlMs);

const server = app.listen(config.port, () => {
  console.log(`Proxy server started on port ${config.port}`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  clearInterval(cleanupInterval);

  server.close(async () => {
    await destroyAllSessions().catch((error) => {
      console.error('Failed to destroy sessions:', error.message);
    });

    await terminateCaptchaWorker().catch((error) => {
      console.error('Failed to terminate captcha worker:', error.message);
    });

    process.exit(0);
  });
}

process.on('SIGINT', () => {
  shutdown('SIGINT').catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

module.exports = {
  app,
  config,
  destroySession
};
