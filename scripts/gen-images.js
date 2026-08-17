// One-off generator for placeholder SVG photos used by the site.
// Run with: bun scripts/gen-images.js

const building = (fg) => `
  <g fill="${fg}" opacity="0.92">
    <rect x="120" y="130" width="160" height="140" rx="4"/>
    <polygon points="100,130 200,60 300,130"/>
    <rect x="150" y="160" width="26" height="26" fill="#ffffff" opacity="0.85"/>
    <rect x="224" y="160" width="26" height="26" fill="#ffffff" opacity="0.85"/>
    <rect x="150" y="200" width="26" height="26" fill="#ffffff" opacity="0.85"/>
    <rect x="224" y="200" width="26" height="26" fill="#ffffff" opacity="0.85"/>
    <rect x="187" y="230" width="26" height="40" fill="#ffffff" opacity="0.85"/>
  </g>`;

const listingImage = (label, from, to) => `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 400 250">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="400" height="250" fill="url(#g)"/>
  ${building("#1f2937")}
  <text x="200" y="222" font-family="'Segoe UI', Arial, sans-serif" font-size="16" font-weight="600" fill="#ffffff" text-anchor="middle" opacity="0.92">${label}</text>
  <text x="200" y="240" font-family="'Segoe UI', Arial, sans-serif" font-size="10.5" font-weight="500" fill="#ffffff" text-anchor="middle" opacity="0.7" letter-spacing="0.5">PHOTO COMING SOON</text>
</svg>`;

const avatar = (initials, from, to) => `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="320" height="320" rx="160" fill="url(#g)"/>
  <text x="160" y="185" font-family="'Segoe UI', Arial, sans-serif" font-size="110" font-weight="700" fill="#ffffff" text-anchor="middle">${initials}</text>
</svg>`;

const hero = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="700" viewBox="0 0 1600 700">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f766e"/>
      <stop offset="100%" stop-color="#134e4a"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="700" fill="url(#sky)"/>
  <g opacity="0.5" fill="#0b2a27">
    <rect x="80" y="380" width="120" height="220"/>
    <rect x="220" y="320" width="90" height="280"/>
    <rect x="330" y="420" width="140" height="180"/>
    <rect x="1350" y="360" width="110" height="240"/>
    <rect x="1230" y="300" width="90" height="300"/>
    <rect x="1120" y="410" width="100" height="190"/>
  </g>
  <g fill="#ffffff" opacity="0.85">
    <ellipse cx="1200" cy="150" rx="140" ry="60"/>
    <ellipse cx="1320" cy="170" rx="100" ry="45"/>
    <ellipse cx="350" cy="120" rx="120" ry="50"/>
  </g>
  <g fill="#065f46">
    <polygon points="700,600 800,380 900,600"/>
    <polygon points="620,600 700,460 780,600" opacity="0.85"/>
    <polygon points="820,600 900,460 980,600" opacity="0.85"/>
  </g>
</svg>`;

const listings = [
  ["listing-4544-20th-ave-ne", "University District", "#7c3aed", "#a78bfa"],
  ["listing-2120-ne-54th-st", "Ravenna", "#0ea5e9", "#67e8f9"],
  ["listing-1714-ne-55th-pl", "Ravenna", "#10b981", "#6ee7b7"],
  ["listing-4316-36th-ave-ne-l", "Bryant", "#f59e0b", "#fbbf24"],
  ["listing-4735-22nd-ave-ne", "University District", "#6366f1", "#a5b4fc"],
  ["listing-121-12th-ave-e-310", "Capitol Hill", "#ef4444", "#fca5a5"],
];

const team = [];

const fs = require("fs");
const outDir = `${import.meta.dir}/../public/images`;
fs.mkdirSync(outDir, { recursive: true });

for (const [name, label, from, to] of listings) {
  fs.writeFileSync(`${outDir}/${name}.svg`, listingImage(label, from, to));
}
for (const [name, initials, from, to] of team) {
  fs.writeFileSync(`${outDir}/${name}.svg`, avatar(initials, from, to));
}
fs.writeFileSync(`${outDir}/hero.svg`, hero);

console.log("Generated", listings.length, "listing images,", team.length, "avatars, and a hero image.");
