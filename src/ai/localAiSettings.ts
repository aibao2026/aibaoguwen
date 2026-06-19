import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { aiProviderPresets, type AiProviderId } from "./modelProviders";

export interface LocalAiSettings {
  providerId: AiProviderId;
  apiKeys: Partial<Record<AiProviderId, string>>;
}

export interface PublicAiSettings {
  providerId: AiProviderId;
  apiKeyConfigured: boolean;
  providers: Array<{ id: AiProviderId; name: string; model: string }>;
}

const defaultProviderId: AiProviderId = "deepseek";

function settingsPath(dataRoot: string): string {
  return join(dataRoot, "ai-settings.json");
}

function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === "string" && aiProviderPresets.some((provider) => provider.id === value);
}

function emptySettings(): LocalAiSettings {
  return { providerId: defaultProviderId, apiKeys: {} };
}

export function readLocalAiSettings(dataRoot: string): LocalAiSettings {
  const filePath = settingsPath(dataRoot);
  if (!existsSync(filePath)) {
    return emptySettings();
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<LocalAiSettings>;
    const providerId = isAiProviderId(parsed.providerId) ? parsed.providerId : defaultProviderId;
    const apiKeys = Object.fromEntries(
      Object.entries(parsed.apiKeys ?? {}).filter(([providerIdValue, apiKey]) => {
        return isAiProviderId(providerIdValue) && typeof apiKey === "string" && apiKey.trim();
      }),
    ) as Partial<Record<AiProviderId, string>>;
    return { providerId, apiKeys };
  } catch {
    return emptySettings();
  }
}

export function writeLocalAiSettings(
  dataRoot: string,
  input: { providerId: AiProviderId; apiKey?: string },
): LocalAiSettings {
  const current = readLocalAiSettings(dataRoot);
  const next: LocalAiSettings = {
    providerId: input.providerId,
    apiKeys: { ...current.apiKeys },
  };
  const apiKey = input.apiKey?.trim();
  if (apiKey) {
    next.apiKeys[input.providerId] = apiKey;
  }

  const filePath = settingsPath(dataRoot);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return next;
}

export function publicAiSettings(dataRoot: string): PublicAiSettings {
  const settings = readLocalAiSettings(dataRoot);
  return {
    providerId: settings.providerId,
    apiKeyConfigured: Boolean(settings.apiKeys[settings.providerId]),
    providers: aiProviderPresets.map((provider) => ({
      id: provider.id,
      name: provider.name,
      model: provider.model,
    })),
  };
}

export function resolveSavedApiKey(
  dataRoot: string,
  providerId: AiProviderId,
): string | undefined {
  return readLocalAiSettings(dataRoot).apiKeys[providerId];
}
