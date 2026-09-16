'use strict';

// Splits a name into alternating text/number chunks so "page10.jpg" sorts
// after "page2.jpg" instead of before it (plain string sort is lexicographic).
function splitChunks(name) {
  return name.match(/\d+|\D+/g) || [name];
}

function naturalCompare(a, b) {
  const chunksA = splitChunks(a);
  const chunksB = splitChunks(b);
  const len = Math.min(chunksA.length, chunksB.length);

  for (let i = 0; i < len; i += 1) {
    const chunkA = chunksA[i];
    const chunkB = chunksB[i];
    if (chunkA === chunkB) continue;

    const numA = Number(chunkA);
    const numB = Number(chunkB);
    const bothNumeric = !Number.isNaN(numA) && !Number.isNaN(numB);
    if (bothNumeric) {
      if (numA !== numB) return numA - numB;
    } else {
      return chunkA < chunkB ? -1 : 1;
    }
  }
  return chunksA.length - chunksB.length;
}

module.exports = { naturalCompare };
