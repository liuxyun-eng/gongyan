import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const CloudBase = require('@cloudbase/manager-node');
export const ENV_ID = 'gongyan-d6gqg5jl234d901e6';
export async function manager() {
  // Read the official CLI's native credential store; never log or persist these values elsewhere.
  const auth = JSON.parse(await fs.readFile(path.join(os.tmpdir(), '.config/.cloudbase/auth.json'), 'utf8')).credential;
  if (!auth?.tmpSecretId || !auth.tmpToken) throw new Error('Official CLI authorization is unavailable');
  return CloudBase.init({ envId: ENV_ID, region: 'ap-shanghai', secretId: auth.tmpSecretId, secretKey: auth.tmpSecretKey, token: auth.tmpToken });
}
