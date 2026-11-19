import { z } from 'zod';

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1, 'Message content cannot be empty'),
});

export const documentChatRequestSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty').max(2000),
  documentId: z.string().uuid().optional(),
  history: z.array(chatMessageSchema).optional().default([]),
});

export type DocumentChatRequest = z.infer<typeof documentChatRequestSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
