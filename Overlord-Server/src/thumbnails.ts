const thumbnails = new Map<string, string>();
const latestFrames = new Map<string, { bytes: Uint8Array; format: string }>();

export function setThumbnail(id: string, dataUrl: string) {
  thumbnails.set(id, dataUrl);
}

export function getThumbnail(id: string) {
  return thumbnails.get(id) ?? null;
}

export function clearThumbnail(id: string) {
  thumbnails.delete(id);
  latestFrames.delete(id);
}

export function setLatestFrame(id: string, bytes: Uint8Array, format: string) {
  latestFrames.set(id, { bytes, format });
}

export function generateThumbnail(id: string): boolean {
  const frameData = latestFrames.get(id);
  if (!frameData) {
    return false;
  }
  
  const { bytes, format } = frameData;
  const b64 = Buffer.from(bytes).toString("base64");
  const mime = format === "webp" ? "image/webp" : "image/jpeg";
  thumbnails.set(id, `data:${mime};base64,${b64}`);
  return true;
}
