// src/utils/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey  = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase-miljövariabler saknas. Kontrollera .env.local');
}

export const supabase = createClient(supabaseUrl, supabaseKey);
