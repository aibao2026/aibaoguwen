import type { Policy } from "../../domain/types";
import type { AppDatabase } from "../connection";

interface PolicyRow {
  id: string;
  policy_number?: string;
  applicant_customer_id?: string;
  insured_customer_id?: string;
  applicant_name: string;
  applicant_masked_id_number?: string;
  insured_name: string;
  insured_masked_id_number?: string;
  product_name: string;
  insurer_name?: string;
  premium?: number;
  payment_method?: string;
  payment_period_raw?: string;
  effective_date?: string;
}

function fromRow(row: PolicyRow): Policy {
  return {
    id: row.id,
    policyNumber: row.policy_number,
    applicantCustomerId: row.applicant_customer_id,
    insuredCustomerId: row.insured_customer_id,
    applicantName: row.applicant_name,
    applicantMaskedIdNumber: row.applicant_masked_id_number,
    insuredName: row.insured_name,
    insuredMaskedIdNumber: row.insured_masked_id_number,
    productName: row.product_name,
    insurerName: row.insurer_name,
    premium: row.premium,
    paymentMethod: row.payment_method,
    paymentPeriodRaw: row.payment_period_raw,
    effectiveDate: row.effective_date,
  };
}

export class PolicyRepository {
  constructor(private readonly db: AppDatabase) {}

  upsertFromImport(policy: Policy): void {
    const params = {
      id: policy.id,
      policyNumber: policy.policyNumber ?? null,
      applicantCustomerId: policy.applicantCustomerId ?? null,
      insuredCustomerId: policy.insuredCustomerId ?? null,
      applicantName: policy.applicantName,
      applicantMaskedIdNumber: policy.applicantMaskedIdNumber ?? null,
      insuredName: policy.insuredName,
      insuredMaskedIdNumber: policy.insuredMaskedIdNumber ?? null,
      productName: policy.productName,
      insurerName: policy.insurerName ?? null,
      premium: policy.premium ?? null,
      paymentMethod: policy.paymentMethod ?? null,
      paymentPeriodRaw: policy.paymentPeriodRaw ?? null,
      effectiveDate: policy.effectiveDate ?? null,
    };

    this.db
      .prepare(
        `
        INSERT INTO policies (
          id, policy_number, applicant_customer_id, insured_customer_id,
          applicant_name, applicant_masked_id_number, insured_name, insured_masked_id_number,
          product_name, insurer_name, premium, payment_method, payment_period_raw, effective_date
        )
        VALUES (
          @id, @policyNumber, @applicantCustomerId, @insuredCustomerId,
          @applicantName, @applicantMaskedIdNumber, @insuredName, @insuredMaskedIdNumber,
          @productName, @insurerName, @premium, @paymentMethod, @paymentPeriodRaw, @effectiveDate
        )
        ON CONFLICT(id) DO UPDATE SET
          policy_number = COALESCE(excluded.policy_number, policies.policy_number),
          applicant_customer_id = COALESCE(excluded.applicant_customer_id, policies.applicant_customer_id),
          insured_customer_id = COALESCE(excluded.insured_customer_id, policies.insured_customer_id),
          applicant_name = excluded.applicant_name,
          applicant_masked_id_number = COALESCE(excluded.applicant_masked_id_number, policies.applicant_masked_id_number),
          insured_name = excluded.insured_name,
          insured_masked_id_number = COALESCE(excluded.insured_masked_id_number, policies.insured_masked_id_number),
          product_name = excluded.product_name,
          insurer_name = COALESCE(excluded.insurer_name, policies.insurer_name),
          premium = COALESCE(excluded.premium, policies.premium),
          payment_method = COALESCE(excluded.payment_method, policies.payment_method),
          payment_period_raw = COALESCE(excluded.payment_period_raw, policies.payment_period_raw),
          effective_date = COALESCE(excluded.effective_date, policies.effective_date)
      `,
      )
      .run(params);
  }

  findByBusinessKey(id: string): Policy | undefined {
    const row = this.db
      .prepare("SELECT * FROM policies WHERE id = ?")
      .get(id) as PolicyRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  updateCorrection(
    id: string,
    input: {
      productName?: string;
      insurerName?: string;
      premium?: number;
      paymentMethod?: string;
      paymentPeriodRaw?: string;
      effectiveDate?: string;
    },
  ): Policy | undefined {
    const result = this.db
      .prepare(
        `
        UPDATE policies
        SET
          product_name = COALESCE(@productName, product_name),
          insurer_name = COALESCE(@insurerName, insurer_name),
          premium = COALESCE(@premium, premium),
          payment_method = COALESCE(@paymentMethod, payment_method),
          payment_period_raw = COALESCE(@paymentPeriodRaw, payment_period_raw),
          effective_date = COALESCE(@effectiveDate, effective_date)
        WHERE id = @id
      `,
      )
      .run({
        id,
        productName: input.productName ?? null,
        insurerName: input.insurerName ?? null,
        premium: input.premium ?? null,
        paymentMethod: input.paymentMethod ?? null,
        paymentPeriodRaw: input.paymentPeriodRaw ?? null,
        effectiveDate: input.effectiveDate ?? null,
      });
    return result.changes > 0 ? this.findByBusinessKey(id) : undefined;
  }

  list(): Policy[] {
    return (this.db.prepare("SELECT * FROM policies ORDER BY insured_name").all() as PolicyRow[]).map(
      fromRow,
    );
  }
}
