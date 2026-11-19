import { createHash } from 'node:crypto';

export function normalizeContent(content: string): string {
  return content.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function hashContent(content: string): string {
  return createHash('sha256').update(normalizeContent(content)).digest('hex');
}
