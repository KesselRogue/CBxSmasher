'use strict';

const fs = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');
const sharp = require('sharp');

const { readArchiveEntries } = require('./archiveReader');
const { naturalCompare } = require('./naturalSort');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff']);
const CONVERT_CONCURRENCY = 4;

/**
 * Runs `worker` over `items` with at most `limit` in flight at once, so a
 * huge omnibus doesn't try to decode/encode every page's worth of image
 * bytes in memory simultaneously.
 */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runOne() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, runOne);
  await Promise.all(workers);
  return results;
}

/**
 * Finds a non-colliding output path by appending " (2)", " (3)", ... before
 * the extension, so converting the same book twice never silently clobbers
 * an earlier result.
 */
async function resolveOutputPath(outputDir, baseName) {
  let candidate = path.join(outputDir, `${baseName}.cbz`);
  let attempt = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await fs.access(candidate);
      attempt += 1;
      candidate = path.join(outputDir, `${baseName} (${attempt}).cbz`);
    } catch {
      return candidate;
    }
  }
}

/**
 * Converts every raster image in a .cbr/.cbz to WebP and repackages it as a
 * new .cbz in `outputDir`. Non-image entries (ComicInfo.xml, etc.) are
 * carried over byte-for-byte. Returns size/count stats for the UI.
 *
 * @param {object} opts
 * @param {string} opts.inputPath
 * @param {string} opts.outputDir
 * @param {number} [opts.quality=82] WebP quality, 1-100 (ignored if lossless).
 * @param {boolean} [opts.lossless=false]
 * @param {(update: object) => void} [opts.onProgress]
 */
async function convertComic({ inputPath, outputDir, quality = 82, lossless = false, onProgress = () => {} }) {
  const baseName = path.basename(inputPath, path.extname(inputPath));
  onProgress({ stage: 'reading', file: baseName });

  const [{ entries }, originalStat] = await Promise.all([
    readArchiveEntries(inputPath),
    fs.stat(inputPath),
  ]);

  entries.sort((a, b) => naturalCompare(a.name, b.name));

  const usedNames = new Set();
  let imagesConverted = 0;
  let imagesSkipped = 0;
  let pageIndex = 0;
  const totalImages = entries.filter((e) => IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase())).length;

  const converted = await mapWithConcurrency(entries, CONVERT_CONCURRENCY, async (entry) => {
    const ext = path.extname(entry.name).toLowerCase();
    let finalName = entry.name;
    let data = entry.data;

    if (IMAGE_EXTENSIONS.has(ext)) {
      pageIndex += 1;
      const current = pageIndex;
      onProgress({ stage: 'converting', file: baseName, current, total: totalImages });
      try {
        data = await sharp(entry.data).webp(lossless ? { lossless: true } : { quality }).toBuffer();
        finalName = `${entry.name.slice(0, -ext.length)}.webp`;
        imagesConverted += 1;
      } catch (err) {
        // A corrupt/unsupported page shouldn't sink the whole book — keep
        // the original bytes for that one entry and carry on.
        imagesSkipped += 1;
      }
    }

    return { name: finalName, data };
  });

  const zip = new AdmZip();
  for (const entry of converted) {
    let name = entry.name;
    let suffix = 2;
    while (usedNames.has(name)) {
      const ext = path.extname(entry.name);
      name = `${entry.name.slice(0, -ext.length || undefined)}_${suffix}${ext}`;
      suffix += 1;
    }
    usedNames.add(name);
    zip.addFile(name, entry.data);
  }

  const outputPath = await resolveOutputPath(outputDir, baseName);
  await zip.writeZipPromise(outputPath);
  const newStat = await fs.stat(outputPath);

  onProgress({ stage: 'done', file: baseName });

  return {
    inputPath,
    outputPath,
    originalSize: originalStat.size,
    newSize: newStat.size,
    pageCount: entries.length,
    imagesConverted,
    imagesSkipped,
  };
}

module.exports = { convertComic, IMAGE_EXTENSIONS };
