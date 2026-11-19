import { z } from 'zod';

export const analysisResultSchema = z.strictObject({
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  feature_requests: z.array(z.strictObject({
    title: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })),
  actionable_insight: z.string().min(1),
});
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
