// Writes public/assets/images/generated/_manifest.json from the single source
// of truth, tools/brand/photos.json, plus the real dimensions of the files on
// disk.
//
//   node tools/build-image-manifest.mjs
//
// The manifest is derived, never hand-edited, so it cannot drift from the
// images that are actually shipped. It also fails loudly if a photo listed in
// photos.json is missing from disk, or a file on disk is missing from it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const source = path.join(root, "tools", "brand", "photos.json");
const outDir = path.join(root, "public", "assets", "images", "generated");
const outFile = path.join(outDir, "_manifest.json");

// PNG/JPEG/WebP dimensions, read from the file header — no image library needed.
function dimensions(file) {
  const b = fs.readFileSync(file);
  if (b[0] === 0x89 && b[1] === 0x50) {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
    const chunk = b.toString("latin1", 12, 16);
    if (chunk === "VP8 ") {
      // Lossy: 3-byte frame tag, 3-byte sync code, then 14-bit width, 14-bit height.
      const sync = 20 + 3;
      if (b[sync] === 0x9d && b[sync + 1] === 0x01 && b[sync + 2] === 0x2a) {
        return { width: b.readUInt16LE(sync + 3) & 0x3fff, height: b.readUInt16LE(sync + 5) & 0x3fff };
      }
    } else if (chunk === "VP8L") {
      // Lossless: 1-byte signature 0x2f, then 14-bit width-1, 14-bit height-1.
      if (b[20] === 0x2f) {
        const bits = b.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    } else if (chunk === "VP8X") {
      // Extended: 4-byte flags, then 24-bit canvas width-1 and height-1.
      const width = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1;
      const height = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1;
      return { width, height };
    }
  }
  return null;
}

const spec = JSON.parse(fs.readFileSync(source, "utf-8"));
const suffixes = spec.sharedSuffixes;

const entries = spec.photos.map((p) => {
  const file = path.join(outDir, p.file);
  if (!fs.existsSync(file)) {
    throw new Error(`photos.json lists ${p.file}, but it is not in ${outDir}`);
  }
  const dim = dimensions(file);
  if (!dim) throw new Error(`could not read the dimensions of ${p.file}`);
  const parts = [p.prompt];
  if (p.extra) parts.push(p.extra);
  parts.push(suffixes[p.suffix] || suffixes.base);
  return {
    file: p.file,
    purpose: p.purpose,
    width: dim.width,
    height: dim.height,
    bytes: fs.statSync(file).size,
    provider: spec.provider,
    model: spec.model,
    prompt: parts.join(", "),
  };
});

// Thumbnails are derived from the photographs above, not generated separately,
// so they carry no prompt — only their source and the transform that made them.
const thumbSpec = spec.thumbnails || { files: [] };
const thumbEntries = [];
for (const t of thumbSpec.files) {
  // Each thumbnail is generated at 1x and, when photos.json declares a 2x
  // width, at 2x as well. The 2x name is the 1x name with the width in it.
  const sizes = [[thumbSpec.width, thumbSpec.height]];
  if (thumbSpec.width2x) sizes.push([thumbSpec.width2x, thumbSpec.height2x]);
  for (const [wantW, wantH] of sizes) {
    const is2x = wantW !== thumbSpec.width;
    const name = is2x
      ? `${t.file.replace(/\.([^.]+)$/, `-${wantW}.$1`)}`
      : t.file;
    const file = path.join(outDir, name);
    if (!fs.existsSync(file)) {
      throw new Error(`photos.json lists ${name}, but it is not in ${outDir}`);
    }
    if (!entries.some((e) => e.file === t.source)) {
      throw new Error(`photos.json thumbnail ${name} names a source that is not listed: ${t.source}`);
    }
    const dim = dimensions(file);
    if (!dim) throw new Error(`could not read the dimensions of ${name}`);
    if (wantW && dim.width !== wantW) {
      throw new Error(`${name} is ${dim.width}px wide, but photos.json says ${wantW}px`);
    }
    if (wantH && dim.height !== wantH) {
      throw new Error(`${name} is ${dim.height}px tall, but photos.json says ${wantH}px`);
    }
    thumbEntries.push({
      file: name,
      source: t.source,
      format: t.format,
      width: dim.width,
      height: dim.height,
      bytes: fs.statSync(file).size,
    });
  }
}

// The WebP renditions are derived from the photographs above, at the widths
// the pages actually draw them at. The file list is derived from the same
// declaration tools/build-image-variants.py reads, so the two cannot disagree.
const variantSpec = spec.webpVariants || { sources: [], widths: [] };
const variantEntries = [];
for (const sourceName of variantSpec.sources || []) {
  if (!entries.some((e) => e.file === sourceName)) {
    throw new Error(`photos.json webpVariants names a source that is not listed: ${sourceName}`);
  }
  for (const width of variantSpec.widths || []) {
    const name = `${sourceName.replace(/\.[^.]+$/, "")}-${width}.webp`;
    const file = path.join(outDir, name);
    if (!fs.existsSync(file)) {
      throw new Error(`photos.json webpVariants implies ${name}, but it is not in ${outDir}`);
    }
    const dim = dimensions(file);
    if (!dim) throw new Error(`could not read the dimensions of ${name}`);
    if (dim.width !== width) {
      throw new Error(`${name} is ${dim.width}px wide, but photos.json says ${width}px`);
    }
    variantEntries.push({
      file: name,
      source: sourceName,
      format: "webp",
      width: dim.width,
      height: dim.height,
      bytes: fs.statSync(file).size,
    });
  }
}

const onDisk = fs
  .readdirSync(outDir)
  .filter((f) => f.endsWith(".jpg") || f.endsWith(".webp"))
  .sort();
const listed = [
  ...entries.map((e) => e.file),
  ...thumbEntries.map((e) => e.file),
  ...variantEntries.map((e) => e.file),
].sort();
const missing = listed.filter((f) => !onDisk.includes(f));
const unlisted = onDisk.filter((f) => !listed.includes(f));
if (missing.length || unlisted.length) {
  throw new Error(
    `photos.json and the generated folder disagree. missing from disk: ${missing.join(", ") || "none"}; ` +
      `on disk but not listed: ${unlisted.join(", ") || "none"}`
  );
}

fs.writeFileSync(
  outFile,
  JSON.stringify(
    {
      note:
        "Generated by tools/build-image-manifest.mjs from tools/brand/photos.json. Do not hand-edit. " +
        "Every image is an AI-generated illustration, not a photograph of a real premises. " +
        "The thumbnails are derived crops of the photographs, not separate generations.",
      ...spec,
      _comment: undefined,
      sharedSuffixes: undefined,
      photos: entries,
      thumbnails: {
        _comment: undefined,
        width: thumbSpec.width,
        height: thumbSpec.height,
        width2x: thumbSpec.width2x,
        height2x: thumbSpec.height2x,
        crop: thumbSpec.crop,
        resample: thumbSpec.resample,
        files: thumbEntries,
      },
      webpVariants: {
        _comment: undefined,
        quality: variantSpec.quality,
        method: variantSpec.method,
        widths: variantSpec.widths,
        files: variantEntries,
      },
    },
    null,
    2
  ) + "\n"
);

console.log(
  `✓ ${path.relative(root, outFile)} (${entries.length} photos, ${thumbEntries.length} thumbnails, ${variantEntries.length} webp renditions)`
);
