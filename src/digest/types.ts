// Plan morning-digest § 1. The contract every part of § 2 builds against.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, after parsing.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job. Times keep the offset from the log (styleguide).
export type DigestRow = {
  job: string;
  owner: string | null; // owner of the job's last line; null renders as —
  runs: number; // lines for this job
  retries: number; // lines with status retry
  lastStatus: RunStatus;
  lastError: string | null; // error of the last line that had one
  firstAt: string;
  lastAt: string;
};

export type StatusCounts = Record<RunStatus, number>;

export type Night = {
  night: string; // YYYY-MM-DD
  rows: DigestRow[]; // sorted by job
  counts: StatusCounts; // lines per status, across all jobs
  badLines: number; // lines that didn't parse; counted, never thrown
};

// null when the night has no file (or isn't a YYYY-MM-DD name). An empty file is a Night with no rows.
export type ReadNight = (runsDir: string, night: string) => Night | null;
