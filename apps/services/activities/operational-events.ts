import { ActivityStorageError } from './storage-codec';
declare const __ROOMS_BUILD_VERSION__: string;
declare const __ROOMS_SOURCE_SHA__: string;
export interface ActivityOperationalEvent {
  service: 'rooms-activities';
  category: 'storage-incompatible' | 'dependency-unavailable';
  operation: 'request' | 'sweep' | 'health' | 'studio-save' | 'studio-load';
  version: string;
  sourceSha: string;
  at: string;
}
export const activityBuildInfo = {
  version: typeof __ROOMS_BUILD_VERSION__ === 'undefined' ? 'development' : __ROOMS_BUILD_VERSION__,
  sourceSha: typeof __ROOMS_SOURCE_SHA__ === 'undefined' ? 'unknown' : __ROOMS_SOURCE_SHA__,
};
/** Fixed categories only. Never serialize the exception, request or stored payload. */
export function activityOperationalReporter(
  write: (event: ActivityOperationalEvent) => void = (event) =>
    console.error(JSON.stringify(event)),
  clock = Date.now,
) {
  const last = new Map<string, number>();
  return (error: unknown, operation: ActivityOperationalEvent['operation']) => {
    const category =
        error instanceof ActivityStorageError ? 'storage-incompatible' : 'dependency-unavailable',
      key = `${operation}:${category}`,
      now = clock(),
      previous = last.get(key);
    if (previous !== undefined && now - previous < 60000) return;
    last.set(key, now);
    try {
      write({
        service: 'rooms-activities',
        category,
        operation,
        ...activityBuildInfo,
        at: new Date(now).toISOString(),
      });
    } catch {
      /* Observability failure cannot replace the original safe response. */
    }
  };
}
