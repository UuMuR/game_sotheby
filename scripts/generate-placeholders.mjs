import { mkdir, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';

const output = new URL('../apps/miniprogram/miniprogram/assets/placeholders/', import.meta.url);
await mkdir(output, { recursive: true });
const colors = {
  black: ['#171717', '#555555'], blue: ['#184b6b', '#4a9fbe'], green: ['#285b43', '#7ead76'],
  yellow: ['#8d6718', '#e0b94f'], red: ['#812d2a', '#d76a59'],
};
for (const [name, [dark, light]] of Object.entries(colors)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 760"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${dark}"/><stop offset="1" stop-color="${light}"/></linearGradient></defs><rect width="600" height="760" rx="28" fill="#f5efe4"/><rect x="30" y="30" width="540" height="700" rx="18" fill="url(#g)"/><circle cx="300" cy="300" r="125" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="8"/><path d="M180 470h240M210 520h180" stroke="#fff" stroke-opacity=".75" stroke-width="12" stroke-linecap="round"/><text x="300" y="325" text-anchor="middle" fill="#fff" font-size="64" font-family="serif">S</text><text x="300" y="650" text-anchor="middle" fill="#fff" font-size="28" font-family="sans-serif">PLACEHOLDER</text></svg>`;
  await writeFile(new URL(`${name}.svg`, output), svg);
}
