// Vercel Serverless Function — وسيط آمن مع سلسلة مزوّدين مجانيين (Gemini ← Groq ← Mistral)
// المتغيرات: GEMINI_API_KEY / GROQ_API_KEY / MISTRAL_API_KEY (ما يتوفر منها يُستخدم)
// اختياري: MODEL, FALLBACK_MODEL (Gemini) · GROQ_MODEL · MISTRAL_MODEL · CHAIN=gemini,groq,mistral · MAX_PER_MIN
const hits = new Map(), cache = new Map();

function limited(ip) {
  const max = Number(process.env.MAX_PER_MIN || 6), now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  return arr.length > max;
}
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return s.length + ':' + h; }

function extractArray(text) {
  const t = (text || '').replace(/```json|```/g, '').trim();
  let v;
  try { v = JSON.parse(t); }
  catch (e) {
    const a = t.indexOf('['), b = t.lastIndexOf(']');
    if (a === -1 || b <= a) throw new Error('no_json_array');
    v = JSON.parse(t.slice(a, b + 1));
  }
  if (!Array.isArray(v) && v && typeof v === 'object') {
    const k = Object.keys(v).find(x => Array.isArray(v[x]));
    if (k) v = v[k];
  }
  if (!Array.isArray(v)) throw new Error('not_array');
  return v;
}

async function geminiOnce(prompt, model) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 8192 } })
  });
  const raw = await r.text();
  if (!r.ok) { let m = raw; try { m = JSON.parse(raw).error.message; } catch (e) {} throw new Error(r.status + ' ' + String(m).slice(0, 160)); }
  const d = JSON.parse(raw), c = d.candidates && d.candidates[0];
  const text = ((c && c.content && c.content.parts) || []).map(p => p.text || '').join('');
  if (!text) throw new Error('empty_reply ' + ((c && c.finishReason) || ''));
  return { text, model };
}
async function gemini(prompt) {
  const models = [process.env.MODEL || 'gemini-flash-lite-latest', process.env.FALLBACK_MODEL, 'gemini-flash-lite-latest', 'gemini-flash-latest']
    .filter((m, i, a) => m && a.indexOf(m) === i);
  let last;
  for (const m of models) {
    try { const o = await geminiOnce(prompt, m); extractArray(o.text); return o; } catch (e) { last = e; }
  }
  throw last;
}

async function chat(url, key, model, prompt) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({ model, temperature: 0, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] })
  });
  const raw = await r.text();
  if (!r.ok) throw new Error(r.status + ' ' + raw.slice(0, 160));
  const d = JSON.parse(raw);
  const text = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
  extractArray(text);
  return { text, model };
}

const PROVIDERS = {
  gemini: { key: 'GEMINI_API_KEY', run: gemini },
  groq: { key: 'GROQ_API_KEY', run: p => chat('https://api.groq.com/openai/v1/chat/completions', process.env.GROQ_API_KEY, process.env.GROQ_MODEL || 'openai/gpt-oss-120b', p) },
  mistral: { key: 'MISTRAL_API_KEY', run: p => chat('https://api.mistral.ai/v1/chat/completions', process.env.MISTRAL_API_KEY, process.env.MISTRAL_MODEL || 'mistral-small-latest', p) }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  if (limited(ip)) return res.status(429).json({ error: 'rate_limited', detail: 'تجاوزت عدد الطلبات المسموح في الدقيقة' });

  const prompt = req.body && req.body.prompt;
  if (typeof prompt !== 'string' || prompt.length < 10 || prompt.length > 100000) return res.status(400).json({ error: 'bad_prompt' });

  const ck = hash(prompt);
  if (cache.has(ck)) return res.status(200).json({ ...cache.get(ck), cached: true });

  const chain = (process.env.CHAIN || 'gemini,groq,mistral').split(',').map(s => s.trim()).filter(p => PROVIDERS[p] && process.env[PROVIDERS[p].key]);
  if (!chain.length) return res.status(500).json({ error: 'server_not_configured', detail: 'لا يوجد أي مفتاح ذكاء اصطناعي مضبوط في Vercel' });

  const errors = [];
  for (const p of chain) {
    try {
      const o = await PROVIDERS[p].run(prompt);
      const out = { result: extractArray(o.text), provider: p, model: o.model };
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      cache.set(ck, out);
      return res.status(200).json(out);
    } catch (e) { errors.push(p + ': ' + String(e && e.message || e).slice(0, 140)); }
  }
  const all429 = errors.every(x => /\b429\b/.test(x));
  return res.status(all429 ? 429 : 502).json({ error: 'all_providers_failed', detail: errors.join(' | ') });
}
