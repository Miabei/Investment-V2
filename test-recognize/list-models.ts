import 'dotenv/config';

const apiKey = process.env.DEEPSEEK_API_KEY;
const baseURL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';

if (!apiKey) {
  console.error('缺少 DEEPSEEK_API_KEY');
  process.exit(1);
}

const url = `${baseURL.replace(/\/$/, '')}/v1/models`;

console.log(`GET ${url}\n`);

const res = await fetch(url, {
  headers: {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  },
});

const text = await res.text();
console.log(`HTTP ${res.status}`);
console.log('---');

try {
  const json = JSON.parse(text);
  console.log(JSON.stringify(json, null, 2));
} catch {
  console.log(text);
}
