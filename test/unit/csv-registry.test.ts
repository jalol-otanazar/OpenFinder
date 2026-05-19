import { describe, expect, it } from 'vitest';
import { RegistryError } from '../../src/core/errors.js';
import { parseCsvRegistry } from '../../src/registry/providers/csv-registry.js';

describe('parseCsvRegistry', () => {
  it('parses rows and resolves columns by candidate name', () => {
    const csv =
      'Provider Name,Web Address,State,Provider Category\n' +
      'Alpha University,https://alpha.edu,VIC,Australian University\n' +
      'Beta College,https://beta.edu,NSW,Vocational provider\n';

    const out = parseCsvRegistry(csv, {
      country: 'Australia',
      registrySource: 'TEQSA',
      columns: {
        name: ['Provider Name'],
        url: ['Web Address'],
        region: ['State'],
        type: ['Provider Category'],
      },
      keepTypes: ['university'],
    });

    expect(out).toHaveLength(1); // the vocational provider is filtered out
    expect(out[0]!.name).toBe('Alpha University');
    expect(out[0]!.official_url).toBe('https://alpha.edu');
    expect(out[0]!.region).toBe('VIC');
  });

  it('supports a semicolon delimiter', () => {
    const csv = 'INSTELLINGSNAAM;INTERNETADRES\nUniversiteit Foo;https://foo.nl\n';
    const out = parseCsvRegistry(csv, {
      country: 'Netherlands',
      registrySource: 'DUO',
      delimiter: ';',
      columns: { name: ['INSTELLINGSNAAM'], url: ['INTERNETADRES'] },
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe('Universiteit Foo');
  });

  it('throws when no name column is recognizable', () => {
    expect(() =>
      parseCsvRegistry('col_a,col_b\n1,2\n', {
        country: 'US',
        registrySource: 'x',
        columns: { name: ['Institution Name'] },
      }),
    ).toThrow(RegistryError);
  });
});
