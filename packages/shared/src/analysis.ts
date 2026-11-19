import { z } from 'zod';

export const sentimentSchema = z.enum(['positive', 'neutral', 'negative']);

export const analysisResultSchema = z.strictObject({
  sentiment: sentimentSchema,
  feature_requests: z.array(z.strictObject({
    title: z.string().trim().min(1),
    confidence: z.number().min(0).max(1),
  })),
  actionable_insight: z.string().trim().min(1),
});
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
