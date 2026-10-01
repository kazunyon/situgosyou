import { createClient } from '@supabase/supabase-js'
import { installerConnection } from './installer-connection'

const url = installerConnection?.url ?? import.meta.env.VITE_SUPABASE_URL
const key = installerConnection?.publishableKey ?? import.meta.env.VITE_SUPABASE_ANON_KEY

export const isCloudConfigured = Boolean(url && key)
export const usesInstallerSync = Boolean(installerConnection)
export const supabaseProjectUrl = url || ''
export const supabasePublicKey = key || ''
export const supabase = isCloudConfigured ? createClient(url!, key!) : null
