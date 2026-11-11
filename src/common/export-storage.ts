import type { SupabaseClient } from '@supabase/supabase-js';

const EXPORTS_BUCKET = 'exports';
const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Sube un archivo de exportación al bucket 'exports' y devuelve una URL
 * firmada de descarga. Si el storage no está configurado (bucket
 * inexistente, credenciales, red) devuelve una URL simulada para no
 * bloquear al frontend.
 */
export async function storeExport(
  admin: SupabaseClient,
  path: string,
  content: string | Buffer,
  contentType: string,
): Promise<string> {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '') ?? '';
  const fallback = `${base}/storage/v1/object/public/${EXPORTS_BUCKET}/${path}`;
  try {
    const storage = (admin as any).storage;
    const { error } = await storage
      .from(EXPORTS_BUCKET)
      .upload(path, content, { contentType, upsert: true });
    if (error) return fallback;
    const { data, error: signError } = await storage
      .from(EXPORTS_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (signError || !data?.signedUrl) return fallback;
    return data.signedUrl;
  } catch {
    return fallback;
  }
}

/** Genera el contenido CSV a partir de encabezados y filas. */
export function toCsv(headers: string[], rows: (string | number | null)[][]) {
  const escape = (v: string | number | null) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) lines.push(row.map(escape).join(','));
  return `﻿${lines.join('\r\n')}`;
}
