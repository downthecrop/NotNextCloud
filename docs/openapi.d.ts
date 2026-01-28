/* Auto-generated from openapi.json. */

export type EnvelopeOk = {
  "ok": true;
  "data": Record<string, unknown>;
  "meta"?: Record<string, unknown>;
};

export type EnvelopeError = {
  "ok": false;
  "error": {
  "code": string;
  "message": string;
  "details"?: Record<string, unknown>;
};
};

export type Root = {
  "id": string;
  "name"?: string;
  "path": string;
  "absPath"?: string;
};

export type Entry = {
  "rootId": string;
  "path": string;
  "name": string;
  "size"?: number;
  "mtime"?: number;
  "mime"?: string;
  "ext"?: string;
  "isDir": boolean;
  "title"?: string | null;
  "artist"?: string | null;
  "album"?: string | null;
  "duration"?: number | null;
  "albumKey"?: string | null;
};

export type ListResponse = {
  "items": Entry[];
  "total": number | null;
  "limit": number;
  "offset": number;
  "nextCursor"?: string | null;
};

export type IndexProgress = {
  "scanId"?: number;
  "startedAt"?: number;
  "mode"?: string;
  "scope"?: string;
  "expectedTotal"?: number | null;
  "processedEntries"?: number;
  "processedFiles"?: number;
  "processedDirs"?: number;
  "currentRootId"?: string | null;
  "currentRootName"?: string | null;
  "currentPath"?: string;
  "totalRoots"?: number;
  "currentRootIndex"?: number;
  "percent"?: number | null;
};

export type IndexStats = {
  "scanId"?: number;
  "finishedAt"?: number;
  "durationMs"?: number;
  "mode"?: string;
  "scope"?: string;
  "processedEntries"?: number;
  "processedFiles"?: number;
  "processedDirs"?: number;
  "expectedTotal"?: number | null;
  "indexedTotal"?: number | null;
};

export type Status = {
  "lastScanAt"?: number | null;
  "scanInProgress": boolean;
  "scanIntervalSeconds": number;
  "fastScan": boolean;
  "fullScanIntervalHours": number;
  "progress"?: IndexProgress;
  "lastScanStats"?: IndexStats;
};

export type Info = {
  "apiVersion": number;
  "serverVersion": string;
  "devMode": boolean;
  "serverTime": string;
  "auth": Record<string, unknown>;
  "capabilities": Record<string, unknown>;
};

export type Bootstrap = {
  "info": Info;
  "roots": Root[];
  "status"?: Status;
};

export type Health = {
  "status": string;
  "devMode": boolean;
  "apiVersion": number;
  "serverVersion": string;
};

export type EnvelopeList = {
  "ok": true;
  "data": ListResponse;
  "meta"?: Record<string, unknown>;
};

export type EnvelopeInfo = {
  "ok": true;
  "data": Info;
  "meta"?: Record<string, unknown>;
};

export type EnvelopeStatus = {
  "ok": true;
  "data": Status;
  "meta"?: Record<string, unknown>;
};

export type EnvelopeBootstrap = {
  "ok": true;
  "data": Bootstrap;
  "meta"?: Record<string, unknown>;
};

export type EnvelopeHealth = {
  "ok": true;
  "data": Health;
  "meta"?: Record<string, unknown>;
};
