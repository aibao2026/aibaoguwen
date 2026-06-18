import { makePolicyBusinessKey } from "../domain/ids";
import type { PendingConfirmation, Policy } from "../domain/types";
import { readWorkbookRows } from "./excelReader";

function value(row: Record<string, unknown>, key: string): string | undefined {
  const raw = row[key];
  if (raw === undefined || raw === null) {
    return undefined;
  }

  const text = String(raw).trim();
  return text ? text : undefined;
}

function numberValue(row: Record<string, unknown>, key: string): number | undefined {
  const text = value(row, key);
  if (!text) {
    return undefined;
  }

  const parsed = Number(text.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function required(valueToCheck: string | undefined): string {
  return valueToCheck ?? "";
}

function missingSheet(filePath: string): PendingConfirmation {
  return {
    id: "pending:policy:missing_sheet",
    reason: "missing_required_field",
    title: "保单明细 Sheet 需确认",
    detail: "未找到名为“结果”的工作表",
    payload: { filePath },
  };
}

export async function importPolicyPerformanceWorkbook(filePath: string): Promise<{
  policies: Policy[];
  confirmations: PendingConfirmation[];
}> {
  const sheets = await readWorkbookRows(filePath);
  const sheet = sheets.find((item) => item.sheetName === "结果");
  if (!sheet) {
    return { policies: [], confirmations: [missingSheet(filePath)] };
  }

  const policies: Policy[] = [];
  const confirmations: PendingConfirmation[] = [];

  sheet.rows.forEach((row, index) => {
    const policyNumber = value(row, "保单号码");
    const applicantName = required(value(row, "投保人"));
    const insuredName = required(value(row, "被保人"));
    const productName = required(value(row, "保险产品"));
    const effectiveDate = value(row, "生效时间");

    if (!applicantName || !insuredName || !productName) {
      confirmations.push({
        id: `pending:policy:missing_required:${index + 2}`,
        reason: "missing_required_field",
        title: "保单关键字段需确认",
        detail: `业绩明细表第 ${index + 2} 行缺少投保人、被保人或产品名`,
        payload: { rowIndex: index + 2 },
      });
      return;
    }

    if (!policyNumber) {
      confirmations.push({
        id: `pending:policy:identity_incomplete:${index + 2}`,
        reason: "identity_incomplete",
        title: "保单号需确认",
        detail: `业绩明细表第 ${index + 2} 行缺少保单号，将只能作为非合并候选记录`,
        payload: { rowIndex: index + 2, applicantName, insuredName, productName },
      });
    }

    policies.push({
      id: makePolicyBusinessKey({
        policyNumber,
        applicantName,
        insuredName,
        productName,
        effectiveDate,
      }),
      policyNumber,
      applicantName,
      applicantMaskedIdNumber: value(row, "投保人证件号"),
      insuredName,
      insuredMaskedIdNumber: value(row, "被保人证件号"),
      insurerName: value(row, "保险公司"),
      productName,
      premium: numberValue(row, "规模保费") ?? numberValue(row, "标准保费"),
      paymentMethod: value(row, "缴费方式"),
      paymentPeriodRaw: value(row, "缴费期间"),
      effectiveDate,
    });
  });

  return { policies, confirmations };
}
