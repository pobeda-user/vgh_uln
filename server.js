import 'dotenv/config';
import express from 'express';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '80mb' }));

const rootDir = path.resolve('.');
const STATIC_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/styles.css', 'styles.css'],
  ['/manifest.json', 'manifest.json'],
  ['/sw.js', 'sw.js'],
  ['/icon.svg', 'icon.svg']
]);

app.get(Array.from(STATIC_FILES.keys()), (req, res) => {
  const rel = STATIC_FILES.get(req.path);
  if (!rel) return res.status(404).end();
  return res.sendFile(path.join(rootDir, rel));
});

app.post('/api/submit', async (req, res) => {
  try {
    const url = process.env.APPS_SCRIPT_URL;
    if (!url) {
      return res.status(500).json({ ok: false, error: 'APPS_SCRIPT_URL is not set on the server.' });
    }

    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body || {})
    });

    const text = await upstream.text();
    res.status(upstream.status).type(upstream.headers.get('content-type') || 'text/plain').send(text);
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(rootDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
