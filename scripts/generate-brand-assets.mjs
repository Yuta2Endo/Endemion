#!/usr/bin/env node
/**
 * Generate all brand assets (favicon, PWA icons, og-image) from reference images
 *
 * Reference sources:
 * - icon-120.png: clean icon (E with orbital ring) on transparent background
 * - icon-square-1254.png: icon in rounded square with "ENDEMION" text below
 * - badge-circle-1254.png: circular badge variant
 * - logo-full-1536x1024.png: full horizontal logo (icon + "ENDEMION" text)
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";

const BRAND_DIR = "brand";
const PUBLIC_DIR = "public";

// Source images (high quality references)
const ICON_CLEAN = `${BRAND_DIR}/reference/icon-120.png`; // Clean transparent icon
const ICON_SQUARE = `${BRAND_DIR}/reference/icon-square-1254.png`; // Icon with text below
const LOGO_FULL = `${BRAND_DIR}/reference/logo-full-1536x1024.png`; // Horizontal logo

// Brand colors (dark background for icons)
const BG_DARK = { r: 8, g: 10, b: 16, alpha: 1 }; // #080a10

async function ensureDir(path) {
  await mkdir(dirname(path), { recursive: true });
}

/**
 * Generate favicon.ico (multi-resolution ICO with 16x16, 32x32, 48x48)
 */
async function generateFaviconIco() {
  console.log("Generating favicon.ico...");

  const sizes = [16, 32, 48];
  const buffers = await Promise.all(
    sizes.map((size) =>
      sharp(ICON_CLEAN)
        .resize(size, size, { fit: "contain", background: BG_DARK })
        .png()
        .toBuffer()
    )
  );

  // ICO format: header + directory entries + PNG data
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type (1 = ICO)
  header.writeUInt16LE(sizes.length, 4); // Number of images

  const dirEntries = Buffer.alloc(16 * sizes.length);
  let offset = 6 + 16 * sizes.length;

  sizes.forEach((size, i) => {
    const entry = dirEntries.subarray(i * 16, (i + 1) * 16);
    entry.writeUInt8(size === 256 ? 0 : size, 0); // Width
    entry.writeUInt8(size === 256 ? 0 : size, 1); // Height
    entry.writeUInt8(0, 2); // Color palette
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(buffers[i].length, 8); // Size
    entry.writeUInt32LE(offset, 12); // Offset
    offset += buffers[i].length;
  });

  const ico = Buffer.concat([header, dirEntries, ...buffers]);
  await ensureDir(`${PUBLIC_DIR}/favicon.ico`);
  await writeFile(`${PUBLIC_DIR}/favicon.ico`, ico);
  console.log(`✓ favicon.ico (${sizes.join(", ")}px)`);
}

/**
 * Generate favicon.svg - simplified vector version for modern browsers
 * Based on the reference icon visual style
 */
async function generateFaviconSvg() {
  console.log("Generating favicon.svg...");

  // Simplified SVG favicon based on the reference design
  // Uses geometric shapes approximating the futuristic E with orbital ring
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6366f1"/>
      <stop offset="50%" style="stop-color:#8b5cf6"/>
      <stop offset="100%" style="stop-color:#a855f7"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="100" height="100" fill="#080a10"/>
  <ellipse cx="50" cy="50" rx="38" ry="38" fill="none" stroke="url(#g)" stroke-width="2" opacity="0.35"/>
  <path d="M32 28h28v6H40v10h18v6H40v12h20v6H32z" fill="url(#g)" filter="url(#glow)"/>
  <circle cx="78" cy="32" r="2.5" fill="#06b6d4" opacity="0.8"/>
</svg>`;

  await ensureDir(`${PUBLIC_DIR}/favicon.svg`);
  await writeFile(`${PUBLIC_DIR}/favicon.svg`, svg);
  console.log("✓ favicon.svg");
}

/**
 * Generate PNG favicons (16x16, 32x32)
 */
async function generateFaviconPngs() {
  console.log("Generating PNG favicons...");

  for (const size of [16, 32]) {
    const output = `${PUBLIC_DIR}/icons/favicon-${size}x${size}.png`;
    await ensureDir(output);
    await sharp(ICON_CLEAN)
      .resize(size, size, { fit: "contain", background: BG_DARK })
      .png()
      .toFile(output);
    console.log(`✓ favicon-${size}x${size}.png`);
  }
}

/**
 * Generate Apple Touch Icon (180x180, solid background required)
 */
async function generateAppleTouchIcon() {
  console.log("Generating apple-touch-icon.png...");

  const output = `${PUBLIC_DIR}/icons/apple-touch-icon.png`;
  await ensureDir(output);

  await sharp(ICON_CLEAN)
    .resize(180, 180, { fit: "contain", background: BG_DARK })
    .png()
    .toFile(output);

  console.log("✓ apple-touch-icon.png (180x180)");
}

/**
 * Generate PWA icons (192x192, 512x512)
 */
async function generatePwaIcons() {
  console.log("Generating PWA icons...");

  for (const size of [192, 512]) {
    const output = `${PUBLIC_DIR}/icons/icon-${size}.png`;
    await ensureDir(output);
    await sharp(ICON_CLEAN)
      .resize(size, size, { fit: "contain", background: BG_DARK })
      .png()
      .toFile(output);
    console.log(`✓ icon-${size}.png`);
  }
}

/**
 * Generate maskable PWA icon (512x512 with 40% safe zone)
 */
async function generateMaskableIcon() {
  console.log("Generating maskable icon...");

  const output = `${PUBLIC_DIR}/icons/icon-maskable-512.png`;
  await ensureDir(output);

  // Maskable icons need content in center 60% (40% safe zone around edges)
  const iconBuffer = await sharp(ICON_CLEAN)
    .resize(307, 307, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: BG_DARK,
    },
  })
    .composite([{ input: iconBuffer, top: 102, left: 102 }])
    .png()
    .toFile(output);

  console.log("✓ icon-maskable-512.png");
}

/**
 * Generate Open Graph image (1200x630) using full horizontal logo
 */
async function generateOgImage() {
  console.log("Generating og-image.png...");

  const output = `${PUBLIC_DIR}/assets/og-image.png`;
  await ensureDir(output);

  // Resize full logo to fit OG dimensions, centered
  const logoBuffer = await sharp(LOGO_FULL)
    .resize(1000, 500, { fit: "inside" })
    .toBuffer();

  const metadata = await sharp(logoBuffer).metadata();

  await sharp({
    create: {
      width: 1200,
      height: 630,
      channels: 4,
      background: BG_DARK,
    },
  })
    .composite([{
      input: logoBuffer,
      top: Math.floor((630 - metadata.height) / 2),
      left: Math.floor((1200 - metadata.width) / 2),
    }])
    .png({ quality: 95, compressionLevel: 9 })
    .toFile(output);

  console.log("✓ og-image.png (1200x630)");
}

/**
 * Generate Google OAuth logo (512x512 square, <1MB PNG)
 * Uses clean icon without text as per Google guidelines
 */
async function generateGoogleOAuthLogo() {
  console.log("Generating Google OAuth logo...");

  const output = `${BRAND_DIR}/google-oauth-logo.png`;
  await ensureDir(output);

  await sharp(ICON_CLEAN)
    .resize(512, 512, { fit: "contain", background: BG_DARK })
    .png({ quality: 90, compressionLevel: 9 })
    .toFile(output);

  const stats = await sharp(output).metadata();
  console.log(`✓ google-oauth-logo.png (512x512, ${Math.round(stats.size / 1024)}KB)`);
}

/**
 * Export optimized brand logos for potential future use
 */
async function exportBrandLogos() {
  console.log("Exporting brand logos...");

  // Clean icon at standard size
  await ensureDir(`${BRAND_DIR}/endemion-icon.png`);
  await sharp(ICON_CLEAN)
    .resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(`${BRAND_DIR}/endemion-icon.png`);

  // Square logo at standard size
  await sharp(ICON_SQUARE)
    .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(`${BRAND_DIR}/endemion-logo-square.png`);

  console.log("✓ endemion-icon.png (256x256)");
  console.log("✓ endemion-logo-square.png (512x512)");
}

// Main execution
async function main() {
  console.log("\n🎨 Generating ENDEMION brand assets from references...\n");

  try {
    await generateFaviconIco();
    await generateFaviconSvg();
    await generateFaviconPngs();
    await generateAppleTouchIcon();
    await generatePwaIcons();
    await generateMaskableIcon();
    await generateOgImage();
    await generateGoogleOAuthLogo();
    await exportBrandLogos();

    console.log("\n✅ All brand assets generated successfully!\n");
    console.log("Next steps:");
    console.log("  1. Review generated assets in public/ and brand/");
    console.log("  2. Upload brand/google-oauth-logo.png to Google Cloud Console");
    console.log("  3. Copy public/favicon.svg to auth/public/favicon.svg");
    console.log("  4. Update Header/Footer to use new brand assets\n");
  } catch (error) {
    console.error("\n❌ Error generating assets:", error);
    process.exit(1);
  }
}

main();
