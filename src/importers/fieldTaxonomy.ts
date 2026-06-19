export type ImportTableKind = "customer" | "policy" | "family" | "unknown";

export type CanonicalFieldKey =
  | "customer.name"
  | "customer.type"
  | "customer.idNumber"
  | "customer.birthDate"
  | "customer.phone"
  | "customer.address"
  | "customer.bankAccount"
  | "customer.policyCount"
  | "customer.firstPremiumTotal"
  | "policy.status"
  | "policy.applicantName"
  | "policy.applicantIdNumber"
  | "policy.insuredName"
  | "policy.insuredIdNumber"
  | "policy.mingyaNumber"
  | "policy.applicationNumber"
  | "policy.policyNumber"
  | "policy.insurerName"
  | "policy.coverageAmount"
  | "policy.productName"
  | "policy.scalePremium"
  | "policy.standardPremium"
  | "policy.serviceFee"
  | "policy.promotionFee"
  | "policy.fyc"
  | "policy.performance"
  | "policy.paymentMethod"
  | "policy.paymentBank"
  | "policy.paymentAccount"
  | "policy.paymentPeriodRaw"
  | "policy.insurancePeriod"
  | "policy.serviceAgentName"
  | "policy.serviceAgentCode"
  | "policy.managerName"
  | "policy.teamName"
  | "policy.directorName"
  | "policy.submittedMethod"
  | "policy.policyYear"
  | "policy.periodNumber"
  | "policy.submittedDate"
  | "policy.effectiveDate"
  | "policy.receiptSignedDate"
  | "policy.receiptOperationDate"
  | "policy.hasAgreement"
  | "policy.salesBranch"
  | "policy.salesDepartment"
  | "policy.policyBranch"
  | "policy.policyDepartment"
  | "policy.isMedical"
  | "policy.medicalCategory"
  | "policy.isPromotion"
  | "policy.assignmentType"
  | "policy.assignmentRate"
  | "policy.isRelay"
  | "policy.needsCallback"
  | "policy.callbackStatus"
  | "policy.callbackDate"
  | "family.memberName"
  | "family.relationship"
  | "family.gender"
  | "family.age"
  | "family.riskType"
  | "family.coverageCategory"
  | "family.coverageItem"
  | "family.coverageType"
  | "family.coveragePeriod"
  | "family.benefitResponsibility"
  | "family.benefitDescription"
  | "family.coverageGap"
  | "family.paymentMonth"
  | "family.survivalBenefit"
  | "family.cashValue"
  | "family.ownerName"
  | "family.ageYear";

export interface CanonicalFieldDefinition {
  key: CanonicalFieldKey;
  label: string;
  kind: ImportTableKind;
  aliases: string[];
  requiredForImport?: boolean;
}

export interface FieldMappingSuggestion {
  sourceField: string;
  canonicalField: CanonicalFieldKey;
  canonicalLabel: string;
  confidence: number;
  source: "rule" | "ai";
}

export interface TableClassification {
  kind: ImportTableKind;
  confidence: number;
  scores: Record<ImportTableKind, number>;
}

export const canonicalFields: CanonicalFieldDefinition[] = [
  { key: "customer.name", label: "客户姓名", kind: "customer", aliases: ["客户姓名", "姓名", "客户", "成员姓名"], requiredForImport: true },
  { key: "customer.type", label: "客户类型", kind: "customer", aliases: ["类型", "客户类型", "角色", "家庭角色"] },
  { key: "customer.idNumber", label: "证件号", kind: "customer", aliases: ["证件号", "身份证号", "客户证件号"], requiredForImport: true },
  { key: "customer.birthDate", label: "出生日期", kind: "customer", aliases: ["出生日期", "生日", "出生年月"], requiredForImport: true },
  { key: "customer.phone", label: "手机号", kind: "customer", aliases: ["手机号", "手机", "联系电话", "电话"] },
  { key: "customer.address", label: "地址", kind: "customer", aliases: ["地址", "联系地址"] },
  { key: "customer.bankAccount", label: "银行账号", kind: "customer", aliases: ["银行账号", "银行卡号", "缴费账号"] },
  { key: "customer.policyCount", label: "保单数量", kind: "customer", aliases: ["保单数量", "保单数"] },
  { key: "customer.firstPremiumTotal", label: "首期保费合计", kind: "customer", aliases: ["首期保费合计", "首期保费", "总保费"] },
  { key: "policy.status", label: "保单状态", kind: "policy", aliases: ["保单状态"] },
  { key: "policy.applicantName", label: "投保人", kind: "policy", aliases: ["投保人", "投保人姓名"], requiredForImport: true },
  { key: "policy.applicantIdNumber", label: "投保人证件号", kind: "policy", aliases: ["投保人证件号", "投保人身份证号"], requiredForImport: true },
  { key: "policy.insuredName", label: "被保人", kind: "policy", aliases: ["被保人", "被保险人", "被保人姓名"], requiredForImport: true },
  { key: "policy.insuredIdNumber", label: "被保人证件号", kind: "policy", aliases: ["被保人证件号", "被保险人证件号"], requiredForImport: true },
  { key: "policy.mingyaNumber", label: "明亚号码", kind: "policy", aliases: ["明亚号码"] },
  { key: "policy.applicationNumber", label: "投保单号码", kind: "policy", aliases: ["投保单号码", "投保单号"] },
  { key: "policy.policyNumber", label: "保单号码", kind: "policy", aliases: ["保单号码", "保单号"], requiredForImport: true },
  { key: "policy.insurerName", label: "保险公司", kind: "policy", aliases: ["保险公司", "承保公司"], requiredForImport: true },
  { key: "policy.coverageAmount", label: "保额", kind: "policy", aliases: ["保额", "基本保额"] },
  { key: "policy.productName", label: "保险产品", kind: "policy", aliases: ["保险产品", "产品名称", "险种名称"], requiredForImport: true },
  { key: "policy.scalePremium", label: "规模保费", kind: "policy", aliases: ["规模保费", "保费"], requiredForImport: true },
  { key: "policy.standardPremium", label: "标准保费", kind: "policy", aliases: ["标准保费"] },
  { key: "policy.serviceFee", label: "保单服务费", kind: "policy", aliases: ["保单服务费", "服务费"] },
  { key: "policy.promotionFee", label: "推广费", kind: "policy", aliases: ["推广费"] },
  { key: "policy.fyc", label: "FYC", kind: "policy", aliases: ["FYC"] },
  { key: "policy.performance", label: "业绩", kind: "policy", aliases: ["业绩"] },
  { key: "policy.paymentMethod", label: "缴费方式", kind: "policy", aliases: ["缴费方式", "交费方式"], requiredForImport: true },
  { key: "policy.paymentBank", label: "缴费银行", kind: "policy", aliases: ["缴费银行", "扣款银行"] },
  { key: "policy.paymentAccount", label: "缴费账号", kind: "policy", aliases: ["缴费账号", "扣款账号"] },
  { key: "policy.paymentPeriodRaw", label: "缴费期间", kind: "policy", aliases: ["缴费期间", "交费期间", "缴费年限"], requiredForImport: true },
  { key: "policy.insurancePeriod", label: "保险期间", kind: "policy", aliases: ["保险期间", "保障期间"] },
  { key: "policy.serviceAgentName", label: "服务人员", kind: "policy", aliases: ["服务人员", "服务经纪人"] },
  { key: "policy.serviceAgentCode", label: "服务人员工号", kind: "policy", aliases: ["服务人员工号", "经纪人工号"] },
  { key: "policy.managerName", label: "所属经理", kind: "policy", aliases: ["所属经理", "经理"] },
  { key: "policy.teamName", label: "所属团队", kind: "policy", aliases: ["所属团队", "团队"] },
  { key: "policy.directorName", label: "所属总监", kind: "policy", aliases: ["所属总监", "总监"] },
  { key: "policy.submittedMethod", label: "交单方式", kind: "policy", aliases: ["交单方式"] },
  { key: "policy.policyYear", label: "保单年度", kind: "policy", aliases: ["保单年度"] },
  { key: "policy.periodNumber", label: "期数", kind: "policy", aliases: ["期数"] },
  { key: "policy.submittedDate", label: "交单日期", kind: "policy", aliases: ["交单日期"] },
  { key: "policy.effectiveDate", label: "生效时间", kind: "policy", aliases: ["生效时间", "生效日期"], requiredForImport: true },
  { key: "policy.receiptSignedDate", label: "客户签署回执日期", kind: "policy", aliases: ["客户签署回执日期"] },
  { key: "policy.receiptOperationDate", label: "回执操作日期", kind: "policy", aliases: ["回执操作日期"] },
  { key: "policy.hasAgreement", label: "有无委托协议号", kind: "policy", aliases: ["有无委托协议号", "委托协议"] },
  { key: "policy.salesBranch", label: "销售所属分公司", kind: "policy", aliases: ["销售所属分公司"] },
  { key: "policy.salesDepartment", label: "销售所属营业部", kind: "policy", aliases: ["销售所属营业部"] },
  { key: "policy.policyBranch", label: "保单所属分公司", kind: "policy", aliases: ["保单所属分公司"] },
  { key: "policy.policyDepartment", label: "保单所属营业部", kind: "policy", aliases: ["保单所属营业部"] },
  { key: "policy.isMedical", label: "是否医疗险", kind: "policy", aliases: ["是否医疗险"] },
  { key: "policy.medicalCategory", label: "医疗部产品分类", kind: "policy", aliases: ["医疗部产品分类"] },
  { key: "policy.isPromotion", label: "是否推广业务", kind: "policy", aliases: ["是否推广业务"] },
  { key: "policy.assignmentType", label: "分单人类型", kind: "policy", aliases: ["分单人类型"] },
  { key: "policy.assignmentRate", label: "分配比例", kind: "policy", aliases: ["分配比例"] },
  { key: "policy.isRelay", label: "是否接力单", kind: "policy", aliases: ["是否接力单"] },
  { key: "policy.needsCallback", label: "是否需要保司回访", kind: "policy", aliases: ["是否需要保司回访"] },
  { key: "policy.callbackStatus", label: "回访状态", kind: "policy", aliases: ["回访状态"] },
  { key: "policy.callbackDate", label: "回访日期", kind: "policy", aliases: ["回访日期"] },
  { key: "family.memberName", label: "家庭成员", kind: "family", aliases: ["家庭成员", "成员", "被保人"] },
  { key: "family.relationship", label: "关系", kind: "family", aliases: ["关系", "家庭关系", "本人", "配偶", "父亲", "母亲"] },
  { key: "family.gender", label: "性别", kind: "family", aliases: ["性别", "男", "女"] },
  { key: "family.age", label: "年龄", kind: "family", aliases: ["年龄", "岁"] },
  { key: "family.riskType", label: "风险类型", kind: "family", aliases: ["风险类型"] },
  { key: "family.coverageCategory", label: "保障类别", kind: "family", aliases: ["保障类别"] },
  { key: "family.coverageItem", label: "保障项目", kind: "family", aliases: ["保障项目"] },
  { key: "family.coverageType", label: "保障类型", kind: "family", aliases: ["保障类型"] },
  { key: "family.coveragePeriod", label: "保障期间", kind: "family", aliases: ["保障期间"] },
  { key: "family.benefitResponsibility", label: "保障责任", kind: "family", aliases: ["保障责任"] },
  { key: "family.benefitDescription", label: "保障内容", kind: "family", aliases: ["保障内容"] },
  { key: "family.coverageGap", label: "保障缺口", kind: "family", aliases: ["保障缺口", "缺口分析"] },
  { key: "family.paymentMonth", label: "交费月份", kind: "family", aliases: ["交费月份", "家庭交费计划"] },
  { key: "family.survivalBenefit", label: "可领取生存金", kind: "family", aliases: ["可领取生存金", "生存金", "合计可领取"] },
  { key: "family.cashValue", label: "现金价值", kind: "family", aliases: ["现金价值", "现价", "合计现价"] },
  { key: "family.ownerName", label: "归属人", kind: "family", aliases: ["归属人", "现价归属人"] },
  { key: "family.ageYear", label: "年龄年度", kind: "family", aliases: ["年龄（岁）", "年龄\n（岁）", "年龄"] },
];

const fieldByKey = new Map(canonicalFields.map((field) => [field.key, field]));

export function canonicalFieldLabel(key: CanonicalFieldKey): string {
  return fieldByKey.get(key)?.label ?? key;
}

export function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[：:]/g, "")
    .trim()
    .toLowerCase();
}

export function matchCanonicalField(header: string): FieldMappingSuggestion | undefined {
  const normalized = normalizeHeader(header);
  if (!normalized) {
    return undefined;
  }

  let best: { field: CanonicalFieldDefinition; score: number } | undefined;
  for (const field of canonicalFields) {
    const aliases = [field.label, ...field.aliases];
    for (const alias of aliases) {
      const normalizedAlias = normalizeHeader(alias);
      if (!normalizedAlias) {
        continue;
      }
      const score =
        normalized === normalizedAlias
          ? 1
          : normalized.includes(normalizedAlias) || normalizedAlias.includes(normalized)
            ? 0.82
            : 0;
      if (score > (best?.score ?? 0)) {
        best = { field, score };
      }
    }
  }

  if (!best || best.score < 0.8) {
    return undefined;
  }

  return {
    sourceField: header,
    canonicalField: best.field.key,
    canonicalLabel: best.field.label,
    confidence: best.score,
    source: "rule",
  };
}

export function classifyFieldMappings(mappings: FieldMappingSuggestion[]): TableClassification {
  const scores: Record<ImportTableKind, number> = {
    customer: 0,
    policy: 0,
    family: 0,
    unknown: 0,
  };

  for (const mapping of mappings) {
    const definition = fieldByKey.get(mapping.canonicalField);
    if (!definition || definition.kind === "unknown") {
      continue;
    }
    scores[definition.kind] += definition.requiredForImport ? 2 : 1;
  }

  const ranked = (["customer", "policy", "family"] as ImportTableKind[]).sort(
    (left, right) => scores[right] - scores[left],
  );
  const top = ranked[0];
  if (!top || scores[top] === 0) {
    return { kind: "unknown", confidence: 0, scores };
  }

  const second = ranked[1] ? scores[ranked[1]] : 0;
  const confidence = Math.min(0.98, Math.max(0.35, (scores[top] - second + 1) / (scores[top] + 1)));
  return { kind: top, confidence, scores };
}

export function classifyFieldMappingsWithContext(
  mappings: FieldMappingSuggestion[],
  context: { fileName?: string; sheetName?: string },
): TableClassification {
  const base = classifyFieldMappings(mappings);
  const contextText = `${context.fileName ?? ""} ${context.sheetName ?? ""}`;
  const familyReportContext = /家庭保障分析报告/.test(context.fileName ?? "");
  const familyContext = /家庭保障|家庭保单|家庭成员|保障缺口|家庭交费|生存金|现金价值|现价|责任明细|保障汇总/.test(
    contextText,
  );
  const hasFamilyFields = mappings.some((mapping) => fieldByKey.get(mapping.canonicalField)?.kind === "family");
  if (familyReportContext || (familyContext && hasFamilyFields)) {
    return {
      ...base,
      kind: "family",
      confidence: Math.max(base.confidence, 0.86),
      scores: {
        ...base.scores,
        family: Math.max(base.scores.family, base.scores.policy + 1, base.scores.customer + 1),
      },
    };
  }
  return base;
}

export function importableMappingsForKind(
  kind: "customer" | "policy",
  mappings: FieldMappingSuggestion[],
): FieldMappingSuggestion[] {
  return mappings.filter((mapping) => fieldByKey.get(mapping.canonicalField)?.kind === kind);
}
