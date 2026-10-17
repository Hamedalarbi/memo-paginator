// Vercel Serverless Function — وسيط آمن بين الصفحة ونموذج الذكاء الاصطناعي
// المتغيرات (Settings → Environment Variables):
//   PROVIDER      = gemini (الافتراضي) أو deepseek
//   GEMINI_API_KEY  أو  DEEPSEEK_API_KEY
//   MODEL         = اسم النموذج كما يظهر في Google AI Studio (مهم، انسخه حرفياً)
//   MAX_PER_MIN   = عدد الطلبات المسموحة لكل زائر في الدقيقة (الافتراضي 6)
const hits = new Map(); // تحديد معدل تقريبي داخل الذاكرة

function limited(ip) {
  const max = Number(process.env.MAX_PER_MIN || 6), now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  return arr.length > max;
}

async function callGemini(prompt) {
  const model = process.env.MODEL || 'gemini-flash-latest';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' }
    })
  });
  if (!r.ok) return { status: r.status };
  const data = await r.json();
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  return { text: parts.map(p => p.text || '').join('') };
}

async function callDeepseek(prompt) {
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.DEEPSEEK_API_KEY },
    body: JSON.stringify({
      model: process.env.MODEL || 'deepseek-v4-flash',
      temperature: 0,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!r.ok) return { status: r.status };
  const data = await r.json();
  return { text: (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  if (limited(ip)) return res.status(429).json({ error: 'rate_limited' });

  const prompt = req.body && req.body.prompt;
  if (typeof prompt !== 'string' || prompt.length < 10 || prompt.length > 60000)
    return res.status(400).json({ error: 'bad_prompt' });

  const provider = (process.env.PROVIDER || 'gemini').toLowerCase();
  const key = provider === 'deepseek' ? process.env.DEEPSEEK_API_KEY : process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'server_not_configured' });

  try {
    const out = provider === 'deepseek' ? await callDeepseek(prompt) : await callGemini(prompt);
    if (out.status) return res.status(out.status === 429 ? 429 : 502).json({ error: 'upstream', status: out.status });
    const text = (out.text || '').replace(/```json|```/g, '').trim();
    const result = JSON.parse(text);
    if (!Array.isArray(result)) throw new Error('not_array');
    return res.status(200).json({ result });
  } catch (e) {
    return res.status(502).json({ error: 'bad_response' });
  }
}
