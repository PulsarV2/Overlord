export type BuildStream = {
  id: string;
  controllers: ReadableStreamDefaultController[];
  status: "running" | "completed" | "failed";
  startTime: number;
  expiresAt: number;
  files: { name: string; size: number; platform?: string }[];
  updates?: any[];
};

export type BuildConfig = {
  platforms: string[];
  serverUrl?: string;
  customId?: string;
  countryCode?: string;
  stripDebug?: boolean;
  disableCgo?: boolean;
  enablePersistence?: boolean;
};
