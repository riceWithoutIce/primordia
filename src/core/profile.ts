export interface CoreProfileSink {
  enabled: boolean;
  now: () => number;
  recordDuration: (phase: string, durationMs: number) => void;
  recordValue: (name: string, value: number) => void;
}

export function measureCoreProfile<T>(sink: CoreProfileSink | null | undefined, phase: string, callback: () => T): T {
  if (!sink?.enabled) {
    return callback();
  }

  const startedAt = sink.now();
  try {
    return callback();
  } finally {
    sink.recordDuration(phase, sink.now() - startedAt);
  }
}
