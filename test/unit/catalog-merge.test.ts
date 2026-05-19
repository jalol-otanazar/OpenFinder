import { describe, expect, it } from 'vitest';
import { mergeCatalogShards } from '../../src/catalog/merge.js';
import type { CatalogShard, ProgramRecord } from '../../src/core/types/program-record.js';

function record(institutionId: string, program: string): ProgramRecord {
  return {
    schema_version: '1.0',
    id: `${institutionId}_${program.toLowerCase().replace(/\W+/g, '_')}`,
    institution_id: institutionId,
    identity: {
      university: institutionId,
      program,
      department: null,
      country: 'UK',
      city: null,
      degree_type: null,
      language: null,
      duration_months: null,
    },
    requirements: null,
    logistics: null,
    cost_and_funding: null,
    outcomes: null,
    provenance: {
      source_urls: [],
      last_verified: '2026-05-19',
      source_confidence: 'web-verified',
      verification_notes: '',
    },
  };
}

function shard(batchId: string, programs: ProgramRecord[]): CatalogShard {
  return { schema_version: '1.0', run_id: 'r1', batch_id: batchId, generated: '2026-05-19', programs };
}

describe('mergeCatalogShards', () => {
  it('concatenates programs across shards', () => {
    const merged = mergeCatalogShards([
      shard('b1', [record('uk_a', 'MSc AI'), record('uk_a', 'MSc Data Science')]),
      shard('b2', [record('uk_b', 'MSc Robotics')]),
    ]);
    expect(merged).toHaveLength(3);
  });

  it('collapses a duplicate program reported by two shards', () => {
    const merged = mergeCatalogShards([
      shard('b1', [record('uk_a', 'MSc in Artificial Intelligence')]),
      shard('b2', [record('uk_a', 'MSc  in   Artificial Intelligence')]),
    ]);
    expect(merged).toHaveLength(1);
  });

  it('keeps same-named programs at different institutions distinct', () => {
    const merged = mergeCatalogShards([
      shard('b1', [record('uk_a', 'MSc AI')]),
      shard('b2', [record('uk_b', 'MSc AI')]),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('returns an empty list for no shards', () => {
    expect(mergeCatalogShards([])).toEqual([]);
  });
});
