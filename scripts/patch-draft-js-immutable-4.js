/*
 * Draft.js 0.11.7 requires two runtime adjustments for Immutable.js 4.
 * Keep these replacements fail-closed and pinned to the exact package version.
 * Upstream reference: https://github.com/facebookarchive/draft-js/commit/381f5d3d3350da214258fb43056b1a3dd81afb2f
 */

const fs = require("fs");
const path = require("path");

const draftPackagePath = require.resolve("draft-js/package.json");
const draftPackage = require(draftPackagePath);
const draftRoot = path.dirname(draftPackagePath);

if (draftPackage.version !== "0.11.7") {
  throw new Error(`Refusing to patch unsupported draft-js ${draftPackage.version}; expected 0.11.7.`);
}

function countOccurrences(source, value) {
  return source.split(value).length - 1;
}

function patchFile(relativePath, replacements) {
  const targetPath = path.join(draftRoot, relativePath);
  let source = fs.readFileSync(targetPath, "utf8");
  let changed = false;

  for (const { before, after } of replacements) {
    if (source.includes(after)) {
      continue;
    }

    const occurrences = countOccurrences(source, before);
    if (occurrences !== 1) {
      throw new Error(`Refusing to patch ${relativePath}: expected one source match, found ${occurrences}.`);
    }

    source = source.replace(before, after);
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(targetPath, source, "utf8");
  }
}

patchFile("lib/ContentState.js", [
  {
    before: "return this.getBlockMap().toArray();",
    after: "return this.getBlockMap().toIndexedSeq().toArray();"
  }
]);

patchFile("lib/randomizeBlockMapKeys.js", [
  {
    before:
      "}).toArray().map(function (block) {\n    return [newKeysRef[block.getKey()], block.set('key', newKeysRef[block.getKey()])];\n  }));",
    after:
      "}).toArray().map(function (entry) {\n    var block = entry[1];\n    return [newKeysRef[block.getKey()], block.set('key', newKeysRef[block.getKey()])];\n  }));"
  },
  {
    before:
      "return OrderedMap(blockMap.toArray().map(function (block) {\n    var key = generateRandomKey();\n    return [key, block.set('key', key)];\n  }));",
    after:
      "return OrderedMap(blockMap.toArray().map(function (entry) {\n    var block = entry[1];\n    var key = generateRandomKey();\n    return [key, block.set('key', key)];\n  }));"
  }
]);

console.log("Applied the Draft.js 0.11.7 compatibility patch for Immutable.js 4.");
