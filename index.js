const path = require('path');
const express = require('express');
const javascriptStringify = require('javascript-stringify').stringify;
const qs = require('qs');
const rateLimit = require('express-rate-limit');
const text2png = require('text2png');

const packageJson = require('./package.json');
const telemetry = require('./telemetry');
const { getPdfBufferFromPng, getPdfBufferWithText } = require('./lib/pdf');
const { logger } = require('./logging');
const { renderChartJs } = require('./lib/charts');
const { renderGraphviz } = require('./lib/graphviz');
const { toChartJs, parseSize } = require('./lib/google_image_charts');
const { renderQr, DEFAULT_QR_SIZE } = require('./lib/qr');

const app = express();

// --- START: Advanced Auth and Rate Limiting ---

// In-memory store for request counts.
const requestCounts = {};
// Map to hold API keys and their associated limits.
const apiKeys = new Map();

// Helper to parse limit strings like "rps:10,rpm:600" or just "10"
function parseLimits(limitString) {
  if (!limitString) return {};

  // If the value is just a number, treat it as RPS
  const plainNumber = parseInt(limitString, 10);
  if (!isNaN(plainNumber) && String(plainNumber) === limitString) {
    return { rps: plainNumber };
  }

  const limits = {};
  limitString.split(',').forEach((part) => {
    const [key, value] = part.split(':');
    const parsedValue = parseInt(value, 10);
    if (['rps', 'rpm', 'rph', 'rpd'].includes(key) && !isNaN(parsedValue)) {
      limits[key] = parsedValue;
    }
  });
  return limits;
}

// Load keys and limits from environment variables on startup.
logger.info('Initializing authentication and rate limiting...');
for (const envVar in process.env) {
  // Correctly match authn0, authn1, etc.
  const authMatch = envVar.match(/^authn(\d{1,4})$/);
  if (authMatch) {
    const keyIndex = authMatch[1];
    const apiKey = process.env[envVar];
    // Correctly match limit0, limit1, etc.
    const limitString = process.env[`limit${keyIndex}`];
    const limits = parseLimits(limitString);
    apiKeys.set(apiKey, limits);
    logger.info(`Loaded API Key (index ${keyIndex}) with limits:`, limits);
  }
}
// Load anonymous limits
const anonymousLimits = parseLimits(process.env.limita);
apiKeys.set('_anonymous_', anonymousLimits);
logger.info('Loaded anonymous user limits:', anonymousLimits);

const authAndRateLimit = (req, res, next) => {
  // 1. Get API key from request
  let key = '_anonymous_';
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    key = authHeader.substring(7, authHeader.length);
  } else if (req.query.key) {
    key = req.query.key;
  }

  // 2. Authenticate key
  if (!apiKeys.has(key)) {
    logger.warn(`Invalid API key provided from IP: ${req.ip}`);
    return failPng(res, 'Unauthorized: Invalid API key.', 401);
  }

  const limits = apiKeys.get(key);
  const now = Date.now();
  const sec = Math.floor(now / 1000);
  const min = Math.floor(now / (1000 * 60));
  const hour = Math.floor(now / (1000 * 60 * 60));
  const day = Math.floor(now / (1000 * 60 * 60 * 24));

  if (!requestCounts[key]) {
    requestCounts[key] = {};
  }
  const counts = requestCounts[key];

  // 3. Check and update counts for each window
  const check = (limit, unit, timestamp) => {
    if (limit === undefined) return true; // No limit set for this window
    if (limit === 0) return false; // Block all requests for this window
    
    const countKey = `count_${unit}`;
    const tsKey = `ts_${unit}`;

    if (counts[tsKey] !== timestamp) {
      counts[tsKey] = timestamp;
      counts[countKey] = 1;
    } else {
      counts[countKey] += 1;
    }
    return counts[countKey] <= limit;
  };

  if (
    !check(limits.rps, 's', sec) ||
    !check(limits.rpm, 'm', min) ||
    !check(limits.rph, 'h', hour) ||
    !check(limits.rpd, 'd', day)
  ) {
    logger.warn(`Rate limit exceeded for key: ${key === '_anonymous_' ? 'anonymous' : key}`);
    return failPng(res, 'Too Many Requests', 429);
  }

  next();
};

// --- END: Advanced Auth and Rate Limiting ---

const isDev = app.get('env') === 'development' || app.get('env') === 'test';

app.set('query parser', (str) =>
  qs.parse(str, {
    decode(s) {
      return decodeURIComponent(s);
    },
  }),
);

app.use(
  express.json({
    limit: process.env.EXPRESS_JSON_LIMIT || '100kb',
  }),
);

app.use(express.urlencoded({ extended: false }));


// --- Public Routes ---
// These routes DO NOT require authentication and are defined before the middleware.
app.get('/', (req, res) => {
  res.send(`
    <h1>QuickChart Image API</h1>
    <p>This is the open-source QuickChart API server.</p>
    <p>See the <a href="https://quickchart.io/documentation/">documentation</a> for usage instructions.</p>
    <p>Try our interactive <a href="/qr-code-api">QR Code Builder</a>.</p>
    <p><a href="/healthcheck">Healthcheck</a></p>
  `);
});
app.post('/telemetry', (req, res) => {
  const chartCount = parseInt(req.body.chartCount, 10);
  const qrCount = parseInt(req.body.qrCount, 10);
  const pid = req.body.pid;
  if (chartCount && !isNaN(chartCount)) {
    telemetry.receive(pid, 'chartCount', chartCount);
  }
  if (qrCount && !isNaN(qrCount)) {
    telemetry.receive(pid, 'qrCount', qrCount);
  }
  res.send({ success: true });
});
app.get('/healthcheck', (req, res) => {
  res.send({ success: true, version: packageJson.version });
});
app.get('/healthcheck/chart', (req, res) => {
  const labels = [...Array(5)].map(() => Math.random());
  const data = [...Array(5)].map(() => Math.random());
  const template = `{type:'bar',data:{labels:[${labels.join(',')}],datasets:[{data:[${data.join(',')}]}]}}`;
  res.redirect(`/chart?c=${template}`);
});


// --- Protected Routes ---
// Apply the auth and rate-limiting middleware to all routes defined below.
app.use(authAndRateLimit);

// Serve static files from the 'public' directory (now protected)
app.use(express.static(path.join(__dirname, 'public')));

// Route for the interactive QR code page (now protected)
app.get('/qr-code-api', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/qr-code-api.html'));
});

// All API routes are now implicitly protected by the app.use(authAndRateLimit) above
app.get('/chart', (req, res) => {
  if (req.query.cht) {
    handleGChart(req, res);
    return;
  }
  const outputFormat = (req.query.f || req.query.format || 'png').toLowerCase();
  const opts = {
    chart: req.query.c || req.query.chart,
    height: req.query.h || req.query.height,
    width: req.query.w || req.query.width,
    backgroundColor: req.query.backgroundColor || req.query.bkg,
    devicePixelRatio: req.query.devicePixelRatio,
    version: req.query.v || req.query.version,
    encoding: req.query.encoding || 'url',
    format: outputFormat,
  };
  if (outputFormat === 'pdf') {
    renderChartToPdf(req, res, opts);
  } else if (outputFormat === 'svg') {
    renderChartToSvg(req, res, opts);
  } else if (!outputFormat || outputFormat === 'png') {
    renderChartToPng(req, res, opts);
  } else {
    logger.error(`Request for unsupported format ${outputFormat}`);
    res.status(500).end(`Unsupported format ${outputFormat}`);
  }
  telemetry.count('chartCount');
});

app.post('/chart', (req, res) => {
  const outputFormat = (req.body.f || req.body.format || 'png').toLowerCase();
  const opts = {
    chart: req.body.c || req.body.chart,
    height: req.body.h || req.body.height,
    width: req.body.w || req.body.width,
    backgroundColor: req.body.backgroundColor || req.body.bkg,
    devicePixelRatio: req.body.devicePixelRatio,
    version: req.body.v || req.body.version,
    encoding: req.body.encoding || 'url',
    format: outputFormat,
  };
  if (outputFormat === 'pdf') {
    renderChartToPdf(req, res, opts);
  } else if (outputFormat === 'svg') {
    renderChartToSvg(req, res, opts);
  } else {
    renderChartToPng(req, res, opts);
  }
  telemetry.count('chartCount');
});

app.get('/qr', (req, res) => {
  const qrText = req.query.text;
  if (!qrText) {
    failPng(res, 'You are missing variable `text`');
    return;
  }
  let format = 'png';
  if (req.query.format === 'svg') {
    format = 'svg';
  }
  const { mode } = req.query;
  const margin = typeof req.query.margin === 'undefined' ? 4 : parseInt(req.query.margin, 10);
  const ecLevel = req.query.ecLevel || undefined;
  const size = Math.min(3000, parseInt(req.query.size, 10)) || DEFAULT_QR_SIZE;
  const darkColor = req.query.dark || '000';
  const lightColor = req.query.light || 'fff';
  const qrOpts = {
    margin,
    width: size,
    errorCorrectionLevel: ecLevel,
    color: {
      dark: darkColor,
      light: lightColor,
    },
  };
  renderQr(format, mode, qrText, qrOpts)
    .then((buf) => {
      res.writeHead(200, {
        'Content-Type': format === 'png' ? 'image/png' : 'image/svg+xml',
        'Content-Length': buf.length,
        'Cache-Control': isDev ? 'no-cache' : 'public, max-age=604800',
      });
      res.end(buf);
    })
    .catch((err) => {
      failPng(res, err);
    });
  telemetry.count('qrCount');
});

app.get('/gchart', handleGChart);


// --- Unchanged Code from original file continues below ---

function utf8ToAscii(str) {
  const enc = new TextEncoder();
  const u8s = enc.encode(str);
  return Array.from(u8s)
    .map((v) => String.fromCharCode(v))
    .join('');
}
function sanitizeErrorHeader(msg) {
  if (typeof msg === 'string') {
    return utf8ToAscii(msg).replace(/\r?\n|\r/g, '');
  }
  return '';
}
function failPng(res, msg, statusCode = 500) {
  res.writeHead(statusCode, {
    'Content-Type': 'image/png',
    'X-quickchart-error': sanitizeErrorHeader(msg),
  });
  res.end(
    text2png(`Chart Error: ${msg}`, {
      padding: 10,
      backgroundColor: '#fff',
    }),
  );
}
function failSvg(res, msg, statusCode = 500) {
  res.writeHead(statusCode, {
    'Content-Type': 'image/svg+xml',
    'X-quickchart-error': sanitizeErrorHeader(msg),
  });
  res.end(`
<svg viewBox="0 0 240 80" xmlns="http://www.w3.org/2000/svg">
  <style>p {font-size: 8px;}</style>
  <foreignObject width="240" height="80" requiredFeatures="http://www.w3.org/TR/SVG11/feature#Extensibility">
    <p xmlns="http://www.w3.org/1999/xhtml">${msg}</p>
  </foreignObject>
</svg>`);
}
async function failPdf(res, msg) {
  const buf = await getPdfBufferWithText(msg);
  res.writeHead(500, {
    'Content-Type': 'application/pdf',
    'X-quickchart-error': sanitizeErrorHeader(msg),
  });
  res.end(buf);
}
function renderChartToPng(req, res, opts) {
  opts.failFn = failPng;
  opts.onRenderHandler = (buf) => {
    res
      .type('image/png')
      .set({
        'Cache-Control': isDev ? 'no-cache' : 'public, max-age=604800',
      })
      .send(buf)
      .end();
  };
  doChartjsRender(req, res, opts);
}
function renderChartToSvg(req, res, opts) {
  opts.failFn = failSvg;
  opts.onRenderHandler = (buf) => {
    res
      .type('image/svg+xml')
      .set({
        'Cache-Control': isDev ? 'no-cache' : 'public, max-age=604800',
      })
      .send(buf)
      .end();
  };
  doChartjsRender(req, res, opts);
}
async function renderChartToPdf(req, res, opts) {
  opts.failFn = failPdf;
  opts.onRenderHandler = async (buf) => {
    const pdfBuf = await getPdfBufferFromPng(buf);
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuf.length,
      'Cache-Control': isDev ? 'no-cache' : 'public, max-age=604800',
    });
    res.end(pdfBuf);
  };
  doChartjsRender(req, res, opts);
}
function doChartjsRender(req, res, opts) {
  if (!opts.chart) {
    opts.failFn(res, 'You are missing variable `c` or `chart`');
    return;
  }
  const width = parseInt(opts.width, 10) || 500;
  const height = parseInt(opts.height, 10) || 300;
  let untrustedInput = opts.chart;
  if (opts.encoding === 'base64') {
    try {
      untrustedInput = Buffer.from(opts.chart, 'base64').toString('utf8');
    } catch (err) {
      logger.warn('base64 malformed', err);
      opts.failFn(res, err);
      return;
    }
  }
  renderChartJs(
    width,
    height,
    opts.backgroundColor,
    opts.devicePixelRatio,
    opts.version || '2.9.4',
    opts.format,
    untrustedInput,
  )
    .then(opts.onRenderHandler)
    .catch((err) => {
      logger.warn('Chart error', err);
      opts.failFn(res, err);
    });
}
async function handleGraphviz(req, res, graphVizDef, opts) {
  try {
    const buf = await renderGraphviz(req.query.chl, opts);
    res
      .status(200)
      .type(opts.format === 'png' ? 'image/png' : 'image/svg+xml')
      .end(buf);
  } catch (err) {
    if (opts.format === 'png') {
      failPng(res, `Graph Error: ${err}`);
    } else {
      failSvg(res, `Graph Error: ${err}`);
    }
  }
}
function handleGChart(req, res) {
  if (req.query.cht.startsWith('gv')) {
    const format = req.query.chof;
    const engine = req.query.cht.indexOf(':') > -1 ? req.query.cht.split(':')[1] : 'dot';
    const opts = {
      format,
      engine,
    };
    if (req.query.chs) {
      const size = parseSize(req.query.chs);
      opts.width = size.width;
      opts.height = size.height;
    }
    handleGraphviz(req, res, req.query.chl, opts);
    return;
  } else if (req.query.cht === 'qr') {
    const size = parseInt(req.query.chs.split('x')[0], 10);
    const qrData = req.query.chl;
    const chldVals = (req.query.chld || '').split('|');
    const ecLevel = chldVals[0] || 'L';
    const margin = chldVals[1] || 4;
    const qrOpts = {
      margin: margin,
      width: size,
      errorCorrectionLevel: ecLevel,
    };
    const format = 'png';
    const encoding = 'UTF-8';
    renderQr(format, encoding, qrData, qrOpts)
      .then((buf) => {
        res.writeHead(200, {
          'Content-Type': format === 'png' ? 'image/png' : 'image/svg+xml',
          'Content-Length': buf.length,
          'Cache-Control': isDev ? 'no-cache' : 'public, max-age=604800',
        });
        res.end(buf);
      })
      .catch((err) => {
        failPng(res, err);
      });
    telemetry.count('qrCount');
    return;
  }
  let converted;
  try {
    converted = toChartJs(req.query);
  } catch (err) {
    logger.error(`GChart error: Could not interpret ${req.originalUrl}`);
    res.status(500).end('Sorry, this chart configuration is not supported right now');
    return;
  }
  if (req.query.format === 'chartjs-config') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
    });
    res.end(javascriptStringify(converted.chart, undefined, 2));
    return;
  }
  renderChartJs(
    converted.width,
    converted.height,
    converted.backgroundColor,
    1.0,
    '2.9.4',
    undefined,
    converted.chart,
  ).then((buf) => {
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': buf.length,
      'Cache-Control': isDev ? 'no-cache' : 'public, max-age=604800',
    });
    res.end(buf);
  });
  telemetry.count('chartCount');
}

const port = process.env.PORT || 3400;
const server = app.listen(port);
const timeout = parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 5000;
server.setTimeout(timeout);
logger.info(`Setting request timeout: ${timeout} ms`);
logger.info(`NODE_ENV: ${process.env.NODE_ENV}`);
logger.info(`Listening on port ${port}`);
if (!isDev) {
  const gracefulShutdown = function gracefulShutdown() {
    logger.info('Received kill signal, shutting down gracefully.');
    server.close(() => {
      logger.info('Closed out remaining connections.');
      process.exit();
    });
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit();
    }, 10 * 1000);
  };
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGABRT', () => {
    logger.info('Caught SIGABRT');
  });
}
module.exports = app;

