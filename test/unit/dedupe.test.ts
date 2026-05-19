import { describe, expect, it } from 'vitest';
import type { CountryCode, RegistryInstitution } from '../../src/core/types/registry.js';
import { dedupeInstitutions } from '../../src/registry/dedupe.js';

function inst(p: Partial<RegistryInstitution> & { name: string }): RegistryInstitution {
  return {
    name: p.name,
    country: (p.country ?? 'UK') as CountryCode,
    region: p.region ?? '',
    official_url: p.official_url ?? '',
    registry_source: p.registry_source ?? 'src',
    raw_id: p.raw_id ?? null,
  };
}

describe('dedupeInstitutions', () => {
  it('merges a cross-source duplicate matched by native id (UKPRN)', () => {
    const hesa = inst({
      name: 'University of Leeds',
      raw_id: '10007795',
      registry_source: 'HESA',
      official_url: 'https://leeds.ac.uk',
    });
    const ofs = inst({
      name: 'University of Leeds',
      raw_id: '10007795',
      registry_source: 'Office for Students Register',
      official_url: '',
    });

    const { institutions, removed } = dedupeInstitutions([hesa, ofs]);
    expect(institutions).toHaveLength(1);
    expect(removed).toBe(1);
    // the gap (missing URL) is filled from the duplicate
    expect(institutions[0]!.official_url).toBe('https://leeds.ac.uk');
  });

  it('merges duplicates matched by hostname', () => {
    const a = inst({ name: 'Foo University', official_url: 'https://foo.edu' });
    const b = inst({ name: 'Foo U.', official_url: 'https://www.foo.edu/about' });
    const { institutions, removed } = dedupeInstitutions([a, b]);
    expect(institutions).toHaveLength(1);
    expect(removed).toBe(1);
  });

  it('keeps genuinely distinct institutions', () => {
    const a = inst({ name: 'University of Alpha', official_url: 'https://alpha.edu' });
    const b = inst({ name: 'University of Beta', official_url: 'https://beta.edu' });
    const { institutions, removed } = dedupeInstitutions([a, b]);
    expect(institutions).toHaveLength(2);
    expect(removed).toBe(0);
  });
});
