import { describe, expect, it } from 'vitest';
import {
  canonicalNameKey,
  canonicalUrl,
  cleanName,
  normalizeHost,
} from '../../src/registry/normalize.js';

describe('canonicalUrl', () => {
  it('forces https and drops the path', () => {
    expect(canonicalUrl('http://Example.com/admissions')).toBe('https://example.com');
  });

  it('adds a protocol to a bare domain', () => {
    expect(canonicalUrl('www.sheffield.ac.uk')).toBe('https://www.sheffield.ac.uk');
  });

  it('returns empty for blank or unparseable input', () => {
    expect(canonicalUrl('')).toBe('');
    expect(canonicalUrl('not a url')).toBe('');
  });
});

describe('normalizeHost', () => {
  it('strips www and lower-cases', () => {
    expect(normalizeHost('https://www.Foo.AC.uk/x')).toBe('foo.ac.uk');
  });

  it('returns empty for junk', () => {
    expect(normalizeHost('')).toBe('');
  });
});

describe('canonicalNameKey', () => {
  it('matches names that differ only in punctuation/case', () => {
    expect(canonicalNameKey('The University of Foo')).toBe(
      canonicalNameKey('the university of foo'),
    );
  });
});

describe('cleanName', () => {
  it('collapses whitespace', () => {
    expect(cleanName('  University   of\tFoo ')).toBe('University of Foo');
  });
});
