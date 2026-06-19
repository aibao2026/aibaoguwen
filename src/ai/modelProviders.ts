export type AiProviderId = "deepseek" | "qwen" | "glm" | "moonshot" | "openai";

export interface AiProviderPreset {
  id: AiProviderId;
  name: string;
  baseUrl: string;
  model: string;
}

export const aiProviderPresets: AiProviderPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/chat/completions",
    model: "deepseek-chat",
  },
  {
    id: "qwen",
    name: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    model: "qwen-plus",
  },
  {
    id: "glm",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    model: "glm-4-flash",
  },
  {
    id: "moonshot",
    name: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1/chat/completions",
    model: "moonshot-v1-8k",
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
  },
];

export function findAiProviderPreset(providerId: string): AiProviderPreset | undefined {
  return aiProviderPresets.find((provider) => provider.id === providerId);
}
