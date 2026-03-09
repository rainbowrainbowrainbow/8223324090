/**
 * db/supabase.js — Supabase client for customers table
 * v20.9.12: Customers migrated to Supabase
 */
const { createClient } = require('@supabase/supabase-js');
const { createLogger } = require('../utils/logger');

const log = createLogger('Supabase');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ngpmdphtflqitfodtnyy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SECRET_KEY;

let supabase = null;

function getSupabase() {
    if (!supabase) {
        if (!SUPABASE_KEY) {
            log.warn('SUPABASE_KEY not set — falling back to Railway DB for customers');
            return null;
        }
        supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
        log.info('Supabase client initialized');
    }
    return supabase;
}

module.exports = { getSupabase };
