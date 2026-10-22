import { z } from 'zod';

export const healthLiveSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
});

export type HealthLive = z.infer<typeof healthLiveSchema>;

export const checkResultSchema = z.object({
  status: z.enum(['ok', 'failed']),
  latencyMs: z.number().nonnegative().optional(),
  detail: z.string().optional(),
});

export type CheckResult = z.infer<typeof checkResultSchema>;

export const healthReadySchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.record(z.string(), checkResultSchema),
});

export type HealthReady = z.infer<typeof healthReadySchema>;
