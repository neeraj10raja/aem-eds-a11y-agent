function isSafePath(path) {
  return typeof path === 'string'
    && path.trim() !== ''
    && path.startsWith('/')
    && !path.includes('..')
    && !path.includes('\\')
    && !path.includes('\0');
}

function validatePaths(paths) {
  const invalid = (paths ?? []).filter((path) => !isSafePath(path));
  if (invalid.length > 0) {
    throw new Error(`paths must be URL paths that start with "/" and do not contain .. or backslashes: ${invalid.join(', ')}`);
  }
  return paths ?? ['/'];
}

export { isSafePath, validatePaths };
