'use strict';

const fs = require('fs/promises');
const AdmZip = require('adm-zip');
const { createExtractorFromData } = require('node-unrar-js');

const ZIP_MAGIC = Buffer.from([0x50, 0x4b]); // "PK"
const RAR_MAGIC_V4 = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]); // "Rar!\x1A\x07\x00"
const RAR_MAGIC_V5 = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]); // "Rar!\x1A\x07\x01\x00"

/**
 * Sniffs the real archive format from its file signature rather than trusting
 * the extension — plenty of real-world .cbr files are actually zip data (and
 * vice versa), so extension-only detection silently mis-extracts them.
 */
function detectFormat(buffer) {
  if (buffer.subarray(0, 2).equals(ZIP_MAGIC)) return 'zip';
  if (
    buffer.subarray(0, RAR_MAGIC_V4.length).equals(RAR_MAGIC_V4) ||
    buffer.subarray(0, RAR_MAGIC_V5.length).equals(RAR_MAGIC_V5)
  ) {
    return 'rar';
  }
  return null;
}

function readZipEntries(buffer) {
  const zip = new AdmZip(buffer);
  return zip
    .getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => ({ name: entry.entryName, data: entry.getData() }));
}

async function readRarEntries(buffer) {
  // node-unrar-js wants a plain ArrayBuffer, not a Node Buffer view that may
  // be backed by a larger shared pool.
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const extractor = await createExtractorFromData({ data: arrayBuffer });
  const { fileHeaders } = extractor.getFileList();
  const names = [...fileHeaders].filter((header) => !header.flags.directory).map((header) => header.name);

  const { files } = extractor.extract({ files: names });
  const entries = [];
  for (const file of files) {
    if (file.fileHeader.flags.directory || !file.extraction) continue;
    entries.push({ name: file.fileHeader.name, data: Buffer.from(file.extraction) });
  }
  return entries;
}

/**
 * Reads every file entry out of a .cbr/.cbz (or any zip/rar) archive.
 * @returns {Promise<{format: 'zip'|'rar', entries: {name: string, data: Buffer}[]}>}
 */
async function readArchiveEntries(filePath) {
  const buffer = await fs.readFile(filePath);
  const format = detectFormat(buffer);

  if (format === 'zip') return { format, entries: readZipEntries(buffer) };
  if (format === 'rar') return { format, entries: await readRarEntries(buffer) };

  throw new Error('Not a recognized CBR/CBZ (zip or rar) archive.');
}

module.exports = { readArchiveEntries, detectFormat };
