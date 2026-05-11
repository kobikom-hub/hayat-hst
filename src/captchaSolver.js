const { createWorker } = require('tesseract.js');

let workerPromise;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng');
  }

  return workerPromise;
}

function normalizeCaptchaText(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

async function solveCaptchaImage(imageBuffer) {
  const worker = await getWorker();
  const result = await worker.recognize(imageBuffer);
  return normalizeCaptchaText(result.data && result.data.text);
}

async function fetchAndSolveCaptcha(session, hospitalRequest, baseUrl) {
  const response = await hospitalRequest(session, {
    baseUrl,
    path: '/captcha.php',
    responseType: 'arraybuffer',
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    }
  });

  const buffer = Buffer.from(response.data);
  const text = await solveCaptchaImage(buffer);

  if (!text) {
    throw new Error('Captcha could not be solved');
  }

  return {
    text,
    buffer
  };
}

async function terminateCaptchaWorker() {
  if (!workerPromise) {
    return;
  }

  const worker = await workerPromise;
  await worker.terminate();
  workerPromise = null;
}

module.exports = {
  fetchAndSolveCaptcha,
  solveCaptchaImage,
  terminateCaptchaWorker
};
