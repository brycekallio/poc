// Draws the P.O.C mark as SVG and renders every PNG size Chrome asks for from it,
// so nothing is ever scaled up from a smaller bitmap (which is what made the old
// icons blurry on Retina). Chrome's manifest only takes PNG, so the SVG is the
// source and the PNGs are what it produces.
//
//   npm run icons
//
// The mark is a dark rounded square holding "p", a blue disc and "c". The letters
// are drawn from circles and bars, not a font, so they look the same everywhere.
// Small sizes get a bolder, tighter variant: at 16 px a thin stroke turns to grey.
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const DARK = "#141414";
const WHITE = "#ffffff";
const BLUE = "#4b8ef0";

// All numbers are in a 128-unit box. `w` is the letter stroke, `r` the ring's outer radius.
const LARGE = { radius: 28, r: 16, w: 9, disc: 15, gap: 5, cy: 62, stem: [44, 98], margin: 12 };
const SMALL = { radius: 26, r: 18, w: 13, disc: 17, gap: 3, cy: 62, stem: [44, 104], margin: 7 };

export function mark(variant) {
  const { radius, r, w, disc, gap, cy, stem, margin } = variant;
  const mid = r - w / 2; // radius of the stroke's centre line
  const pCx = margin + r;
  const oCx = pCx + r + gap + disc;
  const cCx = oCx + disc + gap + r;
  // The "c" is a ring with a gap on the right, 50 degrees either side of 3 o'clock.
  const a = (50 * Math.PI) / 180;
  const [x1, y1] = [cCx + mid * Math.cos(a), cy - mid * Math.sin(a)];
  const [x2, y2] = [cCx + mid * Math.cos(a), cy + mid * Math.sin(a)];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect width="128" height="128" rx="${radius}" fill="${DARK}"/>
  <circle cx="${pCx}" cy="${cy}" r="${mid}" fill="none" stroke="${WHITE}" stroke-width="${w}"/>
  <rect x="${pCx - r}" y="${stem[0]}" width="${w}" height="${stem[1] - stem[0]}" fill="${WHITE}"/>
  <circle cx="${oCx}" cy="${cy}" r="${disc}" fill="${BLUE}"/>
  <path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${mid} ${mid} 0 1 0 ${x2.toFixed(2)} ${y2.toFixed(2)}" fill="none" stroke="${WHITE}" stroke-width="${w}"/>
</svg>
`;
}

// 16, 24, 32 and 48 are the toolbar at 1x, 1.5x, 2x and 3x; 48 and 128 are the extensions page and the store.
const SIZES = [16, 24, 32, 48, 128];

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = new URL("../static/icons/", import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}icon.svg`, mark(LARGE));
  for (const size of SIZES) {
    const svg = mark(size <= 32 ? SMALL : LARGE);
    // density: render the vector at the target size directly, never resample a bitmap.
    await sharp(Buffer.from(svg), { density: (72 * size) / 128 }).resize(size, size).png({ compressionLevel: 9 }).toFile(`${dir}icon-${size}.png`);
  }
  console.log(`Wrote icon.svg and ${SIZES.map((s) => `icon-${s}.png`).join(", ")}`);
}
