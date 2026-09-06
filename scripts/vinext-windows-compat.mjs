import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// vinext 0.0.50 indexes nested static files with Windows filesystem separators.
// Normalize at the directory walk, so assets, compressed variants and .vite
// exclusion all use URL paths. Remove this compatibility patch after upgrading.
export function normalizeStaticCacheSource(source) {
  const original = 'relativePath: path.relative(base, batch[j]),';
  const fixed = 'relativePath: path.relative(base, batch[j]).split(path.sep).join("/"),';
  // Also clean up the earlier local, partial patch (compressed keys stayed wrong).
  source = source.replace(/for \(const \[rawRelativePath, fileInfo\] of allFiles\) \{\r?\n\t\t\tconst relativePath = rawRelativePath.replaceAll\(path.sep, "\/"\);/, 'for (const [relativePath, fileInfo] of allFiles) {');
  if (source.includes(fixed)) return source;
  if (!source.includes(original)) throw new Error('Unsupported vinext static cache source; compatibility patch not applied');
  return source.replace(original, fixed);
}

export async function ensureVinextWindowsCompatibility(root) {
  if (process.platform !== 'win32') return;
  const dir = join(root, 'node_modules', 'vinext');
  const metadata = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  if (metadata.version !== '0.0.50') return;
  const file = join(dir, 'dist', 'server', 'static-file-cache.js');
  const source = await readFile(file, 'utf8');
  const patched = normalizeStaticCacheSource(source);
  if (patched !== source) await writeFile(file, patched, 'utf8');
}
