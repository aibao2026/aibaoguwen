import { describe, expect, it } from "vitest";
import type {
  ConfirmationReason,
  ReminderGroup,
  ReminderStatus,
} from "../../src/domain/types";

describe("domain type values", () => {
  it("keeps reminder groups explicit and stable", () => {
    const groups: ReminderGroup[] = ["birthday", "policy_renewal", "manual_todo"];

    expect(groups).toEqual(["birthday", "policy_renewal", "manual_todo"]);
  });

  it("keeps reminder statuses intentionally small", () => {
    const statuses: ReminderStatus[] = ["pending", "completed"];

    expect(statuses).toEqual(["pending", "completed"]);
  });

  it("keeps confirmation reasons explicit", () => {
    const reasons: ConfirmationReason[] = [
      "unsupported_payment_period",
      "missing_required_field",
      "identity_incomplete",
      "strict_match_failed",
      "key_field_changed",
    ];

    expect(reasons).toContain("key_field_changed");
  });
});
