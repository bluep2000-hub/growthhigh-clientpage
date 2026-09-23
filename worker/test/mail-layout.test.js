import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {describe, it, expect} from 'vitest';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const expression = html.match(/class="tkbd doc\$\{([^}]+)\}/)[1];
describe('mail line breaks across clients', () => {
  for (const CLIENT of ['bowlgames', 'dameungyeol', 'future-client']) {
    it(`preserves email paragraphs for ${CLIENT}`, () => {
      expect(runInNewContext(expression, {CLIENT, t: {channel: '메일'}})).toBe(' mail');
      expect(html).toMatch(/\.tkbd\.doc\.mail p\{white-space:pre-wrap\}/);
      expect(runInNewContext(expression, {CLIENT, t: {channel: '미팅'}})).toBe('');
    });
  }
});
