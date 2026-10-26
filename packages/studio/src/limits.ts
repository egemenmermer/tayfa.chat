/** Wire protocol version of every Studio request and op batch. */
export const STUDIO_PROTOCOL_VERSION = 1;

// Document size. An op that would cross one of these is skipped by `applyOps`, never thrown.
export const MAX_PROJECTS_PER_ROOM = 20;
export const MAX_TRACKS = 32;
export const MAX_CLIPS = 512;
export const MAX_NOTES = 20_000;

// Op batches. The spec's "Limits" section says 64 KB for the request body; Contract v1 caps the serialized
// batch at 60 KB so the envelope always fits under that body limit.
export const MAX_BATCH_OPS = 200;
export const MAX_BATCH_BYTES = 60 * 1024;

// Text (UTF-16 code units, like every zod string length).
export const MAX_PROJECT_NAME = 80;
export const MAX_TRACK_NAME = 40;
export const MAX_CLIP_NAME = 40;
export const MAX_KEY_NAME = 16;

// Musical ranges.
export const MIN_TEMPO = 40;
export const MAX_TEMPO = 240;
export const DEFAULT_TEMPO = 120;
export const MIN_BEATS_PER_BAR = 2;
export const MAX_BEATS_PER_BAR = 12;
/** Upper bound for every beat position and length (a project, clip or note). */
export const MAX_PROJECT_BEATS = 4096;
export const DEFAULT_PROJECT_BEATS = 64;
export const MAX_VOLUME = 1.5;
export const MAX_EQ_DB = 12;
export const TRACK_COLOR_COUNT = 12;
export const MAX_CLIP_OFFSET_SEC = 3600;
export const MIN_CLIP_GAIN_DB = -24;
export const MAX_CLIP_GAIN_DB = 12;

// Routes and presence (activities service + desktop bridge).
/** Long-poll ceiling for `GET …/projects/:projectId?afterSeq=N&waitMs=…`. */
export const MAX_SYNC_WAIT_MS = 25_000;
/** Batches kept after compaction; a client further behind receives a snapshot. */
export const RETAINED_BATCHES = 512;
export const PRESENCE_TTL_MS = 30_000;
export const MAX_PRESENCE_NOTE_IDS = 64;

// Recordings (P2).
export const MAX_RECORDING_BYTES = 8 * 1024 * 1024;
export const MAX_ROOM_RECORDING_BYTES = 200 * 1024 * 1024;
