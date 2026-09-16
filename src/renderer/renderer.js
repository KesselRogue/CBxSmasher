'use strict';

const dropZone = document.getElementById('dropZone');
const browseBtn = document.getElementById('browseBtn');
const outputDirInput = document.getElementById('outputDir');
const chooseOutputBtn = document.getElementById('chooseOutputBtn');
const qualityInput = document.getElementById('quality');
const qualityValue = document.getElementById('qualityValue');
const losslessInput = document.getElementById('lossless');
const clearBtn = document.getElementById('clearBtn');
const convertBtn = document.getElementById('convertBtn');
const queueList = document.getElementById('queueList');
const emptyState = document.getElementById('emptyState');
const summaryEl = document.getElementById('summary');

/** @type {Map<string, object>} keyed by absolute input file path */
const queue = new Map();
let isConverting = false;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function statusLabel(item) {
  switch (item.status) {
    case 'pending':
      return 'Waiting…';
    case 'converting':
      return item.total ? `Converting page ${item.current} / ${item.total}` : 'Reading archive…';
    case 'done':
      return `${formatBytes(item.originalSize)} → ${formatBytes(item.newSize)} (${item.savedPct}% smaller)`;
    case 'error':
      return 'Failed';
    default:
      return '';
  }
}

function render() {
  queueList.innerHTML = '';
  emptyState.hidden = queue.size > 0;

  for (const item of queue.values()) {
    const li = document.createElement('li');
    li.className = 'queue-item';

    const top = document.createElement('div');
    top.className = 'queue-item-top';

    const name = document.createElement('span');
    name.className = 'queue-item-name';
    name.textContent = item.name;
    name.title = item.path;

    const status = document.createElement('span');
    status.className = `queue-item-status status-${item.status}`;
    status.textContent = statusLabel(item);

    top.append(name, status);
    li.append(top);

    if (item.status === 'converting') {
      const track = document.createElement('div');
      track.className = 'progress-track';
      const fill = document.createElement('div');
      fill.className = 'progress-fill';
      const pct = item.total ? Math.round((item.current / item.total) * 100) : 0;
      fill.style.width = `${pct}%`;
      track.append(fill);
      li.append(track);
    }

    if (item.status === 'error' && item.error) {
      const err = document.createElement('div');
      err.className = 'queue-item-error';
      err.textContent = item.error;
      li.append(err);
    }

    queueList.append(li);
  }

  const hasPending = [...queue.values()].some((item) => item.status === 'pending');
  convertBtn.disabled = isConverting || !hasPending;
}

function addFilePaths(paths) {
  let added = false;
  for (const filePath of paths) {
    if (queue.has(filePath)) continue;
    queue.set(filePath, {
      path: filePath,
      name: filePath.split(/[\\/]/).pop(),
      status: 'pending',
      current: 0,
      total: 0,
    });
    added = true;
  }
  if (added) render();
}

async function addFiles(paths) {
  if (paths.length === 0) return;
  const validPaths = await window.cbx.filterComicFiles(paths);
  addFilePaths(validPaths);
}

// --- Drag & drop -----------------------------------------------------------

['dragenter', 'dragover'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('drag-active');
  });
});

['dragleave', 'dragend'].forEach((eventName) => {
  dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-active'));
});

dropZone.addEventListener('drop', async (event) => {
  event.preventDefault();
  dropZone.classList.remove('drag-active');
  const files = [...event.dataTransfer.files];
  const paths = files.map((file) => window.cbx.getPathForFile(file));
  await addFiles(paths);
});

browseBtn.addEventListener('click', async () => {
  const paths = await window.cbx.chooseInputFiles();
  await addFiles(paths);
});

// --- Settings ----------------------------------------------------------

function currentSettings() {
  return {
    outputDir: outputDirInput.value,
    quality: Number(qualityInput.value),
    lossless: losslessInput.checked,
  };
}

chooseOutputBtn.addEventListener('click', async () => {
  const dir = await window.cbx.chooseOutputDir();
  if (dir) outputDirInput.value = dir;
});

qualityInput.addEventListener('input', () => {
  qualityValue.textContent = qualityInput.value;
});
qualityInput.addEventListener('change', () => window.cbx.saveSettings(currentSettings()));
losslessInput.addEventListener('change', () => {
  qualityInput.disabled = losslessInput.checked;
  window.cbx.saveSettings(currentSettings());
});

// --- Queue actions -------------------------------------------------------

clearBtn.addEventListener('click', () => {
  if (isConverting) return;
  queue.clear();
  summaryEl.hidden = true;
  render();
});

window.cbx.onProgress((update) => {
  const item = queue.get(update.inputPath);
  if (!item) return;

  if (update.stage === 'reading') {
    item.status = 'converting';
    item.current = 0;
    item.total = 0;
  } else if (update.stage === 'converting') {
    item.status = 'converting';
    item.current = update.current;
    item.total = update.total;
  } else if (update.stage === 'error') {
    item.status = 'error';
    item.error = update.error;
  }
  render();
});

convertBtn.addEventListener('click', async () => {
  const pending = [...queue.values()].filter((item) => item.status === 'pending');
  if (pending.length === 0) return;

  isConverting = true;
  summaryEl.hidden = true;
  render();

  const settings = currentSettings();
  const results = await window.cbx.convertFiles({
    filePaths: pending.map((item) => item.path),
    ...settings,
  });

  let totalOriginal = 0;
  let totalNew = 0;
  let successCount = 0;

  for (const result of results) {
    const item = queue.get(result.inputPath);
    if (!item) continue;

    if (result.ok) {
      item.status = 'done';
      item.originalSize = result.originalSize;
      item.newSize = result.newSize;
      item.outputPath = result.outputPath;
      item.savedPct = result.originalSize > 0
        ? Math.round((1 - result.newSize / result.originalSize) * 100)
        : 0;
      totalOriginal += result.originalSize;
      totalNew += result.newSize;
      successCount += 1;
    } else {
      item.status = 'error';
      item.error = result.error;
    }
  }

  isConverting = false;
  render();

  if (successCount > 0) {
    const savedPct = totalOriginal > 0 ? Math.round((1 - totalNew / totalOriginal) * 100) : 0;
    summaryEl.hidden = false;
    summaryEl.innerHTML =
      `Converted ${successCount} file${successCount === 1 ? '' : 's'}: ` +
      `${formatBytes(totalOriginal)} → ${formatBytes(totalNew)} ` +
      `(<strong>${savedPct}% smaller</strong>) — saved to ${settings.outputDir}`;
  }
});

// --- Init ------------------------------------------------------------------

(async function init() {
  const settings = await window.cbx.getSettings();
  outputDirInput.value = settings.outputDir;
  qualityInput.value = settings.quality;
  qualityValue.textContent = settings.quality;
  losslessInput.checked = settings.lossless;
  qualityInput.disabled = settings.lossless;
  render();
})();
