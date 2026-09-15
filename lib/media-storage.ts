import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "./supabase/admin";

// Videos go browser → Supabase Storage → Meta (file_url), because Vercel rejects request bodies above 4.5 MB.
const BUCKET = "pulso-ad-media";
/** Supabase's free plan rejects single uploads above 50 MB. */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const VIDEO_EXTENSIONS: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov" };
const DOWNLOAD_URL_SECONDS = 60 * 60;

const storage = () => getSupabaseAdmin().storage;

async function ensureBucket(): Promise<void> {
  if (!(await storage().getBucket(BUCKET)).error) return;
  const { error } = await storage().createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_VIDEO_BYTES,
    allowedMimeTypes: Object.keys(VIDEO_EXTENSIONS),
  });
  if (error && !/already exists/i.test(error.message)) throw new Error(`Supabase Storage: ${error.message}`);
}

/** One-time upload URL for the browser, inside the workspace's own folder. */
export async function createVideoUpload(workspaceId: string, contentType: string): Promise<{ path: string; signedUrl: string }> {
  const extension = VIDEO_EXTENSIONS[contentType];
  if (!extension) throw new Error("Usa un video MP4 o MOV.");
  await ensureBucket();
  const { data, error } = await storage().from(BUCKET).createSignedUploadUrl(`${workspaceId}/${randomUUID()}.${extension}`);
  if (error || !data) throw new Error(`Supabase Storage: ${error?.message ?? "no devolvió la URL de subida"}`);
  return { path: data.path, signedUrl: data.signedUrl };
}

/** Uploaded paths are only usable by the workspace that created them. */
export function ownsVideo(workspaceId: string, path: string): boolean {
  return path.startsWith(`${workspaceId}/`) && !path.includes("..");
}

/** Temporary link Meta downloads the video from. */
export async function signedVideoUrl(path: string): Promise<string> {
  const { data, error } = await storage().from(BUCKET).createSignedUrl(path, DOWNLOAD_URL_SECONDS);
  if (error || !data) throw new Error("No encontramos el video subido. Vuelve a elegirlo.");
  return data.signedUrl;
}

/** Meta keeps its own copy once the ad video is created. */
export async function removeVideo(path: string): Promise<void> {
  const { error } = await storage().from(BUCKET).remove([path]);
  if (error) console.error("Could not remove uploaded video", error.message);
}
