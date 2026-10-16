/**
 * Self-check for src/utils/fileUpload.js — run: node scripts/testFileUpload.js
 *
 * Covers the parts that carry risk: path traversal (a driver's own filename
 * reaches publicIdSuffix, and commonController takes folder off the request
 * body), the file-type whitelist, and the size cap.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uploadDataUrl, uploadRawFile, safeSegment, safeFolder } from '../src/utils/fileUpload.js';

const UPLOAD_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../uploads',
);

// 1x1 png
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const written = [];
const fails = [];
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (error) {
    fails.push(name);
    console.log(`  FAIL  ${name}\n        ${error.message}`);
  }
};

// --- sanitisers -------------------------------------------------------------

await check('safeSegment strips traversal', () => {
  assert.equal(safeSegment('../../etc/passwd'), 'etc-passwd');
  assert.equal(safeSegment('..'), '');
  assert.equal(safeSegment('a/b'), 'a-b');
  assert.equal(safeSegment('....//....//x'), 'x');
});

await check('safeSegment falls back when nothing survives', () => {
  assert.equal(safeSegment('///', 'file'), 'file');
  assert.equal(safeSegment(null, 'file'), 'file');
});

await check('safeFolder keeps depth but drops traversal', () => {
  assert.equal(safeFolder('aadharCardFront/driver-documents'), 'aadharcardfront/driver-documents');
  assert.equal(safeFolder('../../../root'), 'root');
  assert.equal(safeFolder('a/../../b'), 'a/b');
});

// --- writes stay inside the upload root ------------------------------------

await check('a hostile filename still lands inside uploads/', async () => {
  const result = await uploadDataUrl({
    dataUrl: PNG,
    folder: '../../../../tmp',
    publicIdPrefix: '../../escape',
    publicIdSuffix: '../../../etc/passwd',
  });
  written.push(result.storedPath);
  assert.ok(
    result.storedPath.startsWith(UPLOAD_ROOT + path.sep),
    `escaped upload root: ${result.storedPath}`,
  );
  await fs.access(result.storedPath);
});

await check('normal upload returns a usable url and real file', async () => {
  const result = await uploadDataUrl({
    dataUrl: PNG,
    folder: 'selfie/driver-documents',
    publicIdPrefix: 'driver-selfie',
  });
  written.push(result.storedPath);
  assert.match(result.secureUrl, /\/uploads\/selfie\/driver-documents\/driver-selfie-\d+-[0-9a-f]{12}\.png$/);
  assert.equal(result.format, 'png');
  assert.equal(result.resourceType, 'image');
  const stat = await fs.stat(result.storedPath);
  assert.ok(stat.size > 0);
});

await check('two uploads in the same tick do not collide', async () => {
  const [a, b] = await Promise.all([
    uploadDataUrl({ dataUrl: PNG, folder: 'collide', publicIdPrefix: 'x' }),
    uploadDataUrl({ dataUrl: PNG, folder: 'collide', publicIdPrefix: 'x' }),
  ]);
  written.push(a.storedPath, b.storedPath);
  assert.notEqual(a.storedPath, b.storedPath);
});

// --- type whitelist ---------------------------------------------------------

await check('svg is rejected as an image (stored-XSS vector)', async () => {
  await assert.rejects(
    () => uploadDataUrl({ dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }),
    /Unsupported file type/,
  );
});

await check('html is rejected by the raw uploader too', async () => {
  await assert.rejects(
    () => uploadRawFile({ dataUrl: 'data:text/html;base64,PGgxPmhpPC9oMT4=' }),
    /Unsupported file type/,
  );
});

await check('pdf is accepted by the raw uploader only', async () => {
  const result = await uploadRawFile({
    dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK',
    folder: 'resumes',
  });
  written.push(result.storedPath);
  assert.equal(result.format, 'pdf');
  assert.equal(result.resourceType, 'raw');

  await assert.rejects(
    () => uploadDataUrl({ dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK' }),
    /Unsupported file type/,
  );
});

await check('malformed and empty payloads are rejected', async () => {
  await assert.rejects(() => uploadDataUrl({ dataUrl: 'not-a-data-url' }), /valid base64 data URL/);
  await assert.rejects(() => uploadDataUrl({ dataUrl: 'data:image/png;base64,' }), /valid base64 data URL/);
});

await check('oversized upload is rejected', async () => {
  const huge = `data:image/png;base64,${Buffer.alloc(16 * 1024 * 1024).toString('base64')}`;
  await assert.rejects(() => uploadDataUrl({ dataUrl: huge }), /larger than/);
});

// --- cleanup ----------------------------------------------------------------

await Promise.all(written.map((file) => fs.rm(file, { force: true })));
await Promise.all(
  ['collide', 'resumes', 'selfie', 'tmp'].map((dir) =>
    fs.rm(path.join(UPLOAD_ROOT, dir), { recursive: true, force: true }),
  ),
);

console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
process.exit(fails.length ? 1 : 0);
