import { describe, expect, it } from 'vitest';
import { HttpSearchClient } from '../../src/tools/search.js';
import { StubFetcher } from '../helpers/stub-fetcher.js';

const ENDPOINT = 'https://search.test/';
const QUERY = 'University of Sheffield computer science masters';
const QUERY_URL = `${ENDPOINT}?q=${encodeURIComponent(QUERY)}`;

/** A DuckDuckGo-HTML-style results page: two real hits, one ad. */
const RESULTS_HTML = `
<div class="result result--ad">
  <a class="result__a" href="//duckduckgo.com/y.js?ad=1">Sponsored</a>
</div>
<div class="result results_links web-result">
  <h2 class="result__title">
    <a class="result__a"
       href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.sheffield.ac.uk%2Fpostgraduate%2Ftaught&rut=x">
       Postgraduate taught courses</a>
  </h2>
  <a class="result__snippet">Explore our taught masters programmes.</a>
</div>
<div class="result results_links web-result">
  <h2 class="result__title">
    <a class="result__a" href="https://example.edu/programs">Example programs</a>
  </h2>
  <a class="result__snippet">A directly linked result.</a>
</div>`;

describe('HttpSearchClient', () => {
  it('parses results and unwraps redirect URLs', async () => {
    const client = new HttpSearchClient(new StubFetcher({ [QUERY_URL]: { body: RESULTS_HTML } }), ENDPOINT);
    const results = await client.search(QUERY);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: 'Postgraduate taught courses',
      url: 'https://www.sheffield.ac.uk/postgraduate/taught',
      snippet: 'Explore our taught masters programmes.',
    });
    expect(results[1]?.url).toBe('https://example.edu/programs');
  });

  it('respects maxResults', async () => {
    const client = new HttpSearchClient(new StubFetcher({ [QUERY_URL]: { body: RESULTS_HTML } }), ENDPOINT);
    expect(await client.search(QUERY, { maxResults: 1 })).toHaveLength(1);
  });

  it('degrades to no results when the endpoint is unreachable', async () => {
    const client = new HttpSearchClient(new StubFetcher({}), ENDPOINT);
    expect(await client.search(QUERY)).toEqual([]);
  });

  it('degrades to no results on a non-2xx response', async () => {
    const client = new HttpSearchClient(
      new StubFetcher({ [QUERY_URL]: { body: 'rate limited', status: 503 } }),
      ENDPOINT,
    );
    expect(await client.search(QUERY)).toEqual([]);
  });

  it('returns an empty list for a results page with no hits', async () => {
    const client = new HttpSearchClient(
      new StubFetcher({ [QUERY_URL]: { body: '<div class="result result--no-result">No results.</div>' } }),
      ENDPOINT,
    );
    expect(await client.search(QUERY)).toEqual([]);
  });
});
