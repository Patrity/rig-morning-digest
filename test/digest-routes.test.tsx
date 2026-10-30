import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DigestRow, StatusCounts } from '../src/digest/types.js';

type DigestJson = { night: string; rows: DigestRow[]; counts: StatusCounts; badLines: number };

let runsDir: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  copyFileSync('runs/2026-10-28.jsonl', join(runsDir, '2026-10-28.jsonl'));
  writeFileSync(join(runsDir, '2026-10-01.jsonl'), '');
  writeFileSync(
    join(runsDir, '2026-10-15.jsonl'),
    [
      '{"at":"2026-10-15T23:00:00+01:00","job":"b/job","status":"ok","owner":"rook"}',
      'this is not json',
      '{"at":"2026-10-15T23:05:00+01:00","job":"a/job","status":"fail","owner":null,"error":"boom"}',
      '',
    ].join('\n'),
  );
  app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

// Table rows of the page as raw html, one string per <tr> that has data cells.
function rowsOf(html: string): string[] {
  return [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]).filter((r) => r.includes('<td'));
}

function cellsOf(row: string): string[] {
  return [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => (m[1] ?? '').replace(/<[^>]*>/g, '').trim());
}

function rowFor(html: string, job: string): string {
  const row = rowsOf(html).find((r) => cellsOf(r)[0] === job);
  if (!row) throw new Error(`no row for ${job}`);
  return row;
}

const isWarn = (row: string) => /<tr\b[^>]*class="[^"]*\bwarn\b[^"]*"/.test(row);

describe('GET /digest/:night', () => {
  it('renders the night as one table with warn rows', async () => {
    const res = await app.request('/digest/2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html.match(/<table\b/g)).toHaveLength(1);
    expect(rowsOf(html)).toHaveLength(5);
    expect(isWarn(rowFor(html, 'fixtures/refresh'))).toBe(true);
    expect(isWarn(rowFor(html, 'notes/backup'))).toBe(true);
    expect(isWarn(rowFor(html, 'lane/sync'))).toBe(false);
    expect(isWarn(rowFor(html, 'rig/rotate-logs'))).toBe(false);
  });

  it('shows — for a null owner', async () => {
    const html = await (await app.request('/digest/2026-10-28')).text();
    expect(cellsOf(rowFor(html, 'digest/render'))).toContain('—');
  });

  it('404s for a night with no file', async () => {
    const res = await app.request('/digest/2026-09-09');
    expect(res.status).toBe(404);
  });

  it('says nothing ran for an empty night', async () => {
    const res = await app.request('/digest/2026-10-01');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('renders a night with a bad line in the middle', async () => {
    const res = await app.request('/digest/2026-10-15');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(rowsOf(html).map((r) => cellsOf(r)[0])).toEqual(['a/job', 'b/job']);
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the night as JSON', async () => {
    const res = await app.request('/api/digest/2026-10-28');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestJson;
    expect(body.night).toBe('2026-10-28');
    expect(body.rows).toHaveLength(5);
    expect(body.badLines).toBe(1);
    expect(Object.keys(body.counts).sort()).toEqual(['fail', 'ok', 'retry']);
  });

  it('404s with a JSON error for a missing night', async () => {
    const res = await app.request('/api/digest/2026-09-09');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns no rows for an empty night', async () => {
    const res = await app.request('/api/digest/2026-10-01');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestJson;
    expect(body.rows).toEqual([]);
    expect(body.badLines).toBe(0);
  });

  it('counts bad lines in the middle of a night', async () => {
    const body = (await (await app.request('/api/digest/2026-10-15')).json()) as DigestJson;
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['a/job', 'b/job']);
    expect(body.counts).toEqual({ ok: 1, retry: 0, fail: 1 });
  });
});

describe('page and JSON agree', () => {
  it('list the same jobs in the same order', async () => {
    const html = await (await app.request('/digest/2026-10-28')).text();
    const body = (await (await app.request('/api/digest/2026-10-28')).json()) as DigestJson;
    expect(rowsOf(html).map((r) => cellsOf(r)[0])).toEqual(body.rows.map((r) => r.job));
  });
});
