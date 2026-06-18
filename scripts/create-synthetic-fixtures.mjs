import xlsx from "xlsx";

function pad(value, width) {
  return String(value).padStart(width, "0");
}

function birthDate(index) {
  const offset = index - 1;
  const year = 1980 + Math.floor(offset / 336);
  const month = Math.floor((offset % 336) / 28) + 1;
  const day = (offset % 28) + 1;
  return `${year}-${pad(month, 2)}-${pad(day, 2)}`;
}

function fullId(index) {
  return `110101${birthDate(index).replace(/-/g, "")}${pad(index, 4)}`;
}

function maskedId(index) {
  return `11*************${pad(index, 3)}`;
}

const customers = [];
for (let index = 1; index <= 650; index += 1) {
  customers.push({
    客户姓名: `测试客户${pad(index, 4)}`,
    证件号: fullId(index),
    出生日期: birthDate(index),
    手机号: `139${pad(index, 8)}`,
  });
}
customers.push({
  客户姓名: "",
  证件号: "110101199901019999",
  出生日期: "1999-01-01",
  手机号: "13999999999",
});

const customerWorkbook = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(
  customerWorkbook,
  xlsx.utils.json_to_sheet(customers),
  "客户信息",
);
xlsx.writeFile(customerWorkbook, "tests/fixtures/customer-info.xlsx");

const policies = [];
for (let index = 1; index <= 720; index += 1) {
  const duplicateIndex = index > 710 ? index - 710 : index;
  const customerIndex = index > 710 ? duplicateIndex : ((index - 1) % 650) + 1;
  const productName = duplicateIndex % 2 === 0 ? "示例保障计划B" : "示例保障计划A";
  policies.push({
    投保人: `测试客户${pad(customerIndex, 4)}`,
    投保人证件号: maskedId(customerIndex),
    被保人: `测试客户${pad(customerIndex, 4)}`,
    被保人证件号: maskedId(customerIndex),
    保单号码: index === 705 ? "" : `TEST-POLICY-${pad(duplicateIndex, 4)}`,
    保险公司: "示例保险公司",
    保险产品: productName,
    规模保费: 1000 + duplicateIndex,
    标准保费: 1000 + duplicateIndex,
    缴费方式: "年交",
    缴费期间: duplicateIndex % 11 === 0 ? "60周岁" : "5年",
    生效时间: "2026-06-23",
  });
}

const policyWorkbook = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(
  policyWorkbook,
  xlsx.utils.json_to_sheet(policies),
  "结果",
);
xlsx.writeFile(policyWorkbook, "tests/fixtures/policy-performance.xlsx");
