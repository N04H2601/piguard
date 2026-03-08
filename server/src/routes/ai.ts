import { Router, Request, Response } from 'express';
import { aiChatRepo } from '../database/repositories.js';
import { createDashboardAdvice, getAiStatus, getConversationWelcomeMessage } from '../services/ai.service.js';
import { aiLimiter } from '../middleware/rate-limit.js';

const router = Router();

router.get('/status', (_req: Request, res: Response) => {
  res.json({ success: true, data: getAiStatus() });
});

router.get('/conversations', (_req: Request, res: Response) => {
  const archived = _req.query.archived === '1';
  res.json({ success: true, data: aiChatRepo.listConversations(archived) });
});

router.post('/conversations', (_req: Request, res: Response) => {
  if (!getAiStatus().configured) {
    res.status(503).json({ success: false, error: 'OpenAI is not configured. Add your token in Settings > AI.' });
    return;
  }

  const conversation: any = aiChatRepo.createConversation();
  aiChatRepo.addMessage(conversation.id, 'assistant', getConversationWelcomeMessage());
  res.status(201).json({
    success: true,
    data: {
      conversation: aiChatRepo.getConversation(conversation.id),
      messages: aiChatRepo.listMessages(conversation.id),
    },
  });
});

router.get('/conversations/:id/messages', (req: Request, res: Response) => {
  const conversationId = Number(req.params.id);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    res.status(400).json({ success: false, error: 'invalid conversation id' });
    return;
  }

  const conversation = aiChatRepo.getConversation(conversationId);
  if (!conversation) {
    res.status(404).json({ success: false, error: 'conversation not found' });
    return;
  }

  res.json({
    success: true,
    data: {
      conversation,
      messages: aiChatRepo.listMessages(conversationId),
    },
  });
});

router.patch('/conversations/:id', (req: Request, res: Response) => {
  const conversationId = Number(req.params.id);
  const archived = req.body?.archived;

  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    res.status(400).json({ success: false, error: 'invalid conversation id' });
    return;
  }

  if (typeof archived !== 'boolean') {
    res.status(400).json({ success: false, error: 'archived boolean is required' });
    return;
  }

  const conversation = aiChatRepo.getConversation(conversationId);
  if (!conversation) {
    res.status(404).json({ success: false, error: 'conversation not found' });
    return;
  }

  aiChatRepo.setArchived(conversationId, archived);
  res.json({ success: true, data: aiChatRepo.getConversation(conversationId) });
});

router.post('/conversations/archive-all', (req: Request, res: Response) => {
  const archived = req.body?.archived;

  if (typeof archived !== 'boolean') {
    res.status(400).json({ success: false, error: 'archived boolean is required' });
    return;
  }

  aiChatRepo.setArchivedAll(archived);
  res.json({ success: true });
});

router.delete('/conversations/archived', (_req: Request, res: Response) => {
  aiChatRepo.deleteArchivedAll();
  res.json({ success: true });
});

router.delete('/conversations/:id', (req: Request, res: Response) => {
  const conversationId = Number(req.params.id);

  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    res.status(400).json({ success: false, error: 'invalid conversation id' });
    return;
  }

  const conversation = aiChatRepo.getConversation(conversationId);
  if (!conversation) {
    res.status(404).json({ success: false, error: 'conversation not found' });
    return;
  }

  aiChatRepo.deleteConversation(conversationId);
  res.json({ success: true });
});

router.delete('/conversations/:id/memory', (req: Request, res: Response) => {
  const conversationId = Number(req.params.id);

  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    res.status(400).json({ success: false, error: 'invalid conversation id' });
    return;
  }

  const conversation = aiChatRepo.getConversation(conversationId);
  if (!conversation) {
    res.status(404).json({ success: false, error: 'conversation not found' });
    return;
  }

  aiChatRepo.clearMemory(conversationId);
  res.json({
    success: true,
    data: {
      conversation: aiChatRepo.getConversation(conversationId),
      messages: aiChatRepo.listMessages(conversationId),
    },
  });
});

router.post('/chat', aiLimiter, async (req: Request, res: Response) => {
  const conversationId = Number(req.body?.conversationId);
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';

  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    res.status(400).json({ success: false, error: 'conversationId is required' });
    return;
  }

  if (!content) {
    res.status(400).json({ success: false, error: 'content is required' });
    return;
  }

  const conversation: any = aiChatRepo.getConversation(conversationId);
  if (!conversation) {
    res.status(404).json({ success: false, error: 'conversation not found' });
    return;
  }

  try {
    const existingMessages = aiChatRepo.listMessages(conversationId) as any[];
    const hadUserMessages = existingMessages.some((message) => message.role === 'user');
    aiChatRepo.addMessage(conversationId, 'user', content.slice(0, 4000));

    if (!hadUserMessages || shouldRetitleConversation(conversation.title)) {
      aiChatRepo.renameConversation(conversationId, buildConversationTitle(content));
    }

    const messages = aiChatRepo.listMessages(conversationId).map((message: any) => ({
      role: message.role,
      content: message.content,
    }));

    const result = await createDashboardAdvice(messages);
    aiChatRepo.addMessage(conversationId, 'assistant', result.answer);

    res.json({
      success: true,
      data: {
        answer: result.answer,
        model: result.model,
        conversation: aiChatRepo.getConversation(conversationId),
        messages: aiChatRepo.listMessages(conversationId),
      },
    });
  } catch (err) {
    res.status(503).json({
      success: false,
      error: err instanceof Error ? err.message : 'AI assistant unavailable',
    });
  }
});

function buildConversationTitle(content: string) {
  const cleaned = content.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Nouvelle conversation';
  return cleaned.length > 72 ? `${cleaned.slice(0, 69)}...` : cleaned;
}

function shouldRetitleConversation(title: string) {
  return title === 'Nouvelle conversation' || title === 'Memoire effacee';
}

export default router;
