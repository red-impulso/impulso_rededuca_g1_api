import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private client?: SupabaseClient;

  /** Cliente con service role: saltea RLS, usar solo desde el backend. */
  get admin(): SupabaseClient {
    if (!this.client) {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) {
        throw new Error(
          'Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno',
        );
      }
      this.client = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }
    return this.client;
  }
}
