import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),
  WECHAT_APP_ID: z.string().min(1),
  WECHAT_APP_SECRET: z.string().min(1),
  SESSION_SECRET: z.string().min(16),
});

export type ServerConfig = z.infer<typeof ConfigSchema>;
export function loadConfig(environment: NodeJS.ProcessEnv): ServerConfig { return ConfigSchema.parse(environment); }
