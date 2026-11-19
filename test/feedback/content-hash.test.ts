import { describe, expect, it } from 'vitest';
import { hashContent, normalizeContent } from '../../src/feedback/content-hash.js';

describe('normalizeContent', () => {
  it('trims, collapses whitespace and lowercases', () => {
    expect(normalizeContent('  Add \t\n Dark   Mode ')).toBe('add dark mode');
  });
});

describe('hashContent', () => {
  it('gives the same hash for content that normalizes the same', () => {
    expect(hashContent('  Add  Dark Mode ')).toBe(hashContent('add dark mode'));
  });

  it('gives different hashes for different content', () => {
    expect(hashContent('add dark mode')).not.toBe(hashContent('add light mode'));
  });

  it('returns a SHA-256 hex digest', () => {
    expect(hashContent('add dark mode')).toMatch(/^[0-9a-f]{64}$/);
  });
});
