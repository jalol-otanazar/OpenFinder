import { describe, expect, it } from 'vitest';
import {
  asPositiveInt,
  asString,
  asStringArray,
  parseJsonArray,
  parseJsonObject,
  truncate,
} from '../../src/llm/parse.js';
import { extractLinks, htmlToText } from '../../src/tools/html.js';

describe('htmlToText', () => {
  it('drops script/style and collapses whitespace', () => {
    const html = '<html><body><h1>Hi</h1><script>ignore()</script><p>  there\n  </p></body></html>';
    expect(htmlToText(html)).toBe('Hi there');
  });
});

describe('extractLinks', () => {
  const html = `<a href="/a">A</a><a href="/a">dup</a>
    <a href="https://x.test/b">B</a><a href="mailto:z@x.test">mail</a>`;

  it('resolves, dedups, drops non-http, and respects the limit', () => {
    const links = extractLinks(html, 'https://x.test', 10);
    expect(links.map((l) => l.url)).toEqual(['https://x.test/a', 'https://x.test/b']);
  });

  it('caps the number of links', () => {
    expect(extractLinks(html, 'https://x.test', 1)).toHaveLength(1);
  });
});

describe('parseJsonArray / parseJsonObject', () => {
  it('extracts an array wrapped in prose or fences', () => {
    expect(parseJsonArray('Sure! ```json\n[1, 2, 3]\n``` done')).toEqual([1, 2, 3]);
  });

  it('returns [] for non-array or garbage', () => {
    expect(parseJsonArray('no json here')).toEqual([]);
    expect(parseJsonArray('{"a":1}')).toEqual([]);
  });

  it('extracts an object and returns {} for garbage', () => {
    expect(parseJsonObject('here: {"a": 1} ok')).toEqual({ a: 1 });
    expect(parseJsonObject('nothing')).toEqual({});
  });
});

describe('coercion helpers', () => {
  it('asString trims and rejects blanks / non-strings', () => {
    expect(asString('  hi ')).toBe('hi');
    expect(asString('   ')).toBeNull();
    expect(asString(42)).toBeNull();
  });

  it('asPositiveInt accepts numbers and numeric strings', () => {
    expect(asPositiveInt(12)).toBe(12);
    expect(asPositiveInt('12')).toBe(12);
    expect(asPositiveInt(0)).toBeNull();
    expect(asPositiveInt('twelve')).toBeNull();
  });

  it('asStringArray keeps only non-blank strings', () => {
    expect(asStringArray(['a', '', 3, ' b '])).toEqual(['a', 'b']);
    expect(asStringArray('not an array')).toEqual([]);
  });

  it('truncate caps with an ellipsis', () => {
    expect(truncate('abcdef', 3)).toBe('abc…');
    expect(truncate('abc', 10)).toBe('abc');
  });
});
