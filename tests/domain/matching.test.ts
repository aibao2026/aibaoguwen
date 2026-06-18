import { describe, expect, it } from "vitest";
import { matchCustomerIdentity } from "../../src/domain/matching";

describe("strict customer identity matching", () => {
  it("matches same name and same full ID", () => {
    expect(
      matchCustomerIdentity(
        { name: "测试客户0001", idNumber: "110101198001010001" },
        { name: "测试客户0001", idNumber: "110101198001010001" },
      ),
    ).toEqual({ matched: true, confidence: "strict" });
  });

  it("matches same name when full ID fits masked prefix and suffix", () => {
    expect(
      matchCustomerIdentity(
        { name: "测试客户0002", idNumber: "110101198001010002" },
        { name: "测试客户0002", idNumber: "11*************002" },
      ),
    ).toEqual({ matched: true, confidence: "strict" });
  });

  it("matches masked IDs only when both visible prefix and suffix match", () => {
    expect(
      matchCustomerIdentity(
        { name: "测试客户0002", idNumber: "11*************002" },
        { name: "测试客户0002", idNumber: "11*************002" },
      ),
    ).toEqual({ matched: true, confidence: "strict" });
  });

  it("does not match when names differ even if IDs match", () => {
    expect(
      matchCustomerIdentity(
        { name: "测试客户0002", idNumber: "110101198001010002" },
        { name: "测试客户9999", idNumber: "110101198001010002" },
      ),
    ).toEqual({ matched: false, reason: "name_mismatch" });
  });

  it("does not match when only prefix matches", () => {
    expect(
      matchCustomerIdentity(
        { name: "测试客户0002", idNumber: "110101198001010002" },
        { name: "测试客户0002", idNumber: "11*************999" },
      ),
    ).toEqual({ matched: false, reason: "id_mismatch" });
  });

  it("does not match when only suffix matches", () => {
    expect(
      matchCustomerIdentity(
        { name: "测试客户0002", idNumber: "110101198001010002" },
        { name: "测试客户0002", idNumber: "99*************002" },
      ),
    ).toEqual({ matched: false, reason: "id_mismatch" });
  });

  it("does not match automatically when ID is missing", () => {
    expect(
      matchCustomerIdentity(
        { name: "测试客户0002", idNumber: "110101198001010002" },
        { name: "测试客户0002" },
      ),
    ).toEqual({ matched: false, reason: "missing_id" });
  });
});
