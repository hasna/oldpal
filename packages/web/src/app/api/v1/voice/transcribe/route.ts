import { ElevenLabsSTT } from '@hasna/assistants-core';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { successResponse, errorResponse } from '@/lib/api/response';

export const POST = withAuth(async (request: AuthenticatedRequest) => {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const language = formData.get('language');

    if (!(file instanceof File)) {
      return errorResponse(new Error('Missing audio file.'));
    }

    const audioBuffer = await file.arrayBuffer();
    const stt = new ElevenLabsSTT({
      language: typeof language === 'string' ? language : undefined,
    });
    const result = await stt.transcribe(audioBuffer);

    return successResponse({
      text: result.text,
      confidence: result.confidence,
      language: result.language,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
