import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://jerraibjvwishoebnavw.supabase.co";
const supabaseKey = "sb_publishable_Kq_IwvjW4kyzB2Ff6I1Dmg_tn69EvNM";

export const supabase = createClient(supabaseUrl, supabaseKey);

// Helper: convert Firestore-style data to Supabase format
export function toSnakeCase(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();
    result[snakeKey] = value;
  }
  return result;
}
