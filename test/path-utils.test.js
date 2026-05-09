import assert from 'node:assert/strict';
import test from 'node:test';

import { isSafePath, validatePaths } from '../a11y-agent/path-utils.js';

test('isSafePath accepts normal URL paths', () => {
  assert.equal(isSafePath('/'), true);
  assert.equal(isSafePath('/blog/post'), true);
});

test('isSafePath rejects traversal, backslashes, and non-path input', () => {
  assert.equal(isSafePath('../secret'), false);
  assert.equal(isSafePath('/../secret'), false);
  assert.equal(isSafePath('\\blog'), false);
  assert.equal(isSafePath('blog'), false);
  assert.equal(isSafePath(''), false);
  assert.equal(isSafePath(null), false);
});

test('validatePaths throws clear errors for invalid entries', () => {
  assert.throws(
    () => validatePaths(['/ok', '/../bad']),
    /paths must be URL paths/,
  );
  assert.deepEqual(validatePaths(['/ok']), ['/ok']);
});
