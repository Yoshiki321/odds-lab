// adapter.ts - LLM API 适配器（用户提供 key 后接入，当前 stub）
// 支持 OpenAI / Anthropic / 本地模型

export interface LLMRequest {
  model: string;
  prompt: string;
  maxTokens?: number;
}

export interface LLMResponse {
  text: string;
  usage?: { prompt: number; completion: number };
}

/** LLM 适配器 stub（用户提供 API key 后实现） */
export async function callLLM(req: LLMRequest): Promise<LLMResponse> {
  // TODO: 用户提供 API key 后对接
  // if (process.env.OPENAI_API_KEY) { ... }
  // if (process.env.ANTHROPIC_API_KEY) { ... }
  throw new Error('[llm] adapter not configured - provide API key in env or config');
}
