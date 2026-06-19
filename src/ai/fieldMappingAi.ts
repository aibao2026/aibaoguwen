import { canonicalFields, type CanonicalFieldKey, type FieldMappingSuggestion } from "../importers/fieldTaxonomy";
import { findAiProviderPreset, type AiProviderId } from "./modelProviders";

interface AiChoice {
  message?: {
    content?: string;
  };
}

interface AiCompletionResponse {
  choices?: AiChoice[];
}

export interface AiFieldMappingInput {
  providerId: AiProviderId;
  apiKey: string;
  fileName: string;
  sheetName: string;
  headers: string[];
  sampleRows: Array<Record<string, string>>;
}

function redactSampleValue(fieldName: string, value: string): string {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  if (/证件|身份证|手机号|电话|账号|银行/.test(fieldName)) {
    return "[已隐藏]";
  }
  if (/^\d{11}$/.test(text) || /^\d{6,}$/.test(text)) {
    return "[已隐藏]";
  }
  return text.slice(0, 40);
}

function redactedSamples(rows: Array<Record<string, string>>) {
  return rows.slice(0, 3).map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([fieldName, value]) => [fieldName, redactSampleValue(fieldName, value)]),
    ),
  );
}

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("ai_mapping_json_missing");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

function isCanonicalFieldKey(value: unknown): value is CanonicalFieldKey {
  return typeof value === "string" && canonicalFields.some((field) => field.key === value);
}

export async function requestAiFieldMappings(
  input: AiFieldMappingInput,
): Promise<FieldMappingSuggestion[]> {
  const provider = findAiProviderPreset(input.providerId);
  if (!provider) {
    throw new Error("unsupported_ai_provider");
  }

  const allowedFields = canonicalFields.map((field) => ({
    key: field.key,
    label: field.label,
    kind: field.kind,
  }));
  const response = await fetch(provider.baseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "你是保险客户表格字段识别助手。只返回 JSON 数组，不要解释。不要推断保费、生日、缴费期间等业务结果，只判断字段名对应关系。",
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "把 sourceField 映射到 canonicalField。无法判断的字段不要返回。",
            fileName: input.fileName,
            sheetName: input.sheetName,
            headers: input.headers,
            redactedSamples: redactedSamples(input.sampleRows),
            allowedCanonicalFields: allowedFields,
            outputShape: [
              {
                sourceField: "原始字段名",
                canonicalField: "allowedCanonicalFields.key",
                confidence: 0.9,
              },
            ],
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`ai_mapping_failed:${response.status}`);
  }

  const data = (await response.json()) as AiCompletionResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("ai_mapping_empty");
  }

  const parsed = extractJson(content);
  if (!Array.isArray(parsed)) {
    throw new Error("ai_mapping_invalid");
  }

  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const sourceField = "sourceField" in item ? String(item.sourceField) : "";
    const canonicalField = "canonicalField" in item ? item.canonicalField : undefined;
    const confidenceRaw = "confidence" in item ? Number(item.confidence) : 0.72;
    const definition = canonicalFields.find((field) => field.key === canonicalField);
    if (!sourceField || !isCanonicalFieldKey(canonicalField) || !definition) {
      return [];
    }
    return [
      {
        sourceField,
        canonicalField,
        canonicalLabel: definition.label,
        confidence: Number.isFinite(confidenceRaw)
          ? Math.max(0.1, Math.min(0.99, confidenceRaw))
          : 0.72,
        source: "ai" as const,
      },
    ];
  });
}
