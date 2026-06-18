import { makeCustomerBusinessKey } from "../domain/ids";
import type { Customer, PendingConfirmation } from "../domain/types";
import { readWorkbookRows } from "./excelReader";

function value(row: Record<string, unknown>, key: string): string | undefined {
  const raw = row[key];
  if (raw === undefined || raw === null) {
    return undefined;
  }

  const text = String(raw).trim();
  return text ? text : undefined;
}

function pendingMissingName(rowIndex: number): PendingConfirmation {
  return {
    id: `pending:customer:missing_name:${rowIndex}`,
    reason: "missing_required_field",
    title: "客户姓名需确认",
    detail: `客户信息表第 ${rowIndex} 行缺少客户姓名`,
    payload: { rowIndex },
  };
}

export async function importCustomerInfoWorkbook(filePath: string): Promise<{
  customers: Customer[];
  confirmations: PendingConfirmation[];
}> {
  const sheets = await readWorkbookRows(filePath);
  const sheet = sheets.find((item) => item.sheetName === "客户信息");
  if (!sheet) {
    return {
      customers: [],
      confirmations: [
        {
          id: "pending:customer:missing_sheet",
          reason: "missing_required_field",
          title: "客户信息 Sheet 需确认",
          detail: "未找到名为“客户信息”的工作表",
          payload: { filePath },
        },
      ],
    };
  }

  const customers: Customer[] = [];
  const confirmations: PendingConfirmation[] = [];

  sheet.rows.forEach((row, index) => {
    const name = value(row, "客户姓名");
    const fullIdNumber = value(row, "证件号");
    if (!name) {
      if (Object.keys(row).length > 0) {
        confirmations.push(pendingMissingName(index + 2));
      }
      return;
    }

    customers.push({
      id: makeCustomerBusinessKey({ name, idNumber: fullIdNumber }),
      name,
      fullIdNumber,
      phone: value(row, "手机号"),
      birthDate: value(row, "出生日期"),
    });
  });

  return { customers, confirmations };
}
