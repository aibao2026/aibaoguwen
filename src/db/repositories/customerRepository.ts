import type { AppDatabase } from "../connection";
import type { Customer } from "../../domain/types";

interface CustomerRow {
  id: string;
  name: string;
  full_id_number?: string;
  masked_id_number?: string;
  phone?: string;
  birth_date?: string;
}

function fromRow(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    fullIdNumber: row.full_id_number,
    maskedIdNumber: row.masked_id_number,
    phone: row.phone,
    birthDate: row.birth_date,
  };
}

export class CustomerRepository {
  constructor(private readonly db: AppDatabase) {}

  upsertFromImport(customer: Customer): void {
    const params = {
      id: customer.id,
      name: customer.name,
      fullIdNumber: customer.fullIdNumber ?? null,
      maskedIdNumber: customer.maskedIdNumber ?? null,
      phone: customer.phone ?? null,
      birthDate: customer.birthDate ?? null,
    };

    this.db
      .prepare(
        `
        INSERT INTO customers (id, name, full_id_number, masked_id_number, phone, birth_date)
        VALUES (@id, @name, @fullIdNumber, @maskedIdNumber, @phone, @birthDate)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          full_id_number = COALESCE(excluded.full_id_number, customers.full_id_number),
          masked_id_number = COALESCE(excluded.masked_id_number, customers.masked_id_number),
          phone = COALESCE(excluded.phone, customers.phone),
          birth_date = COALESCE(excluded.birth_date, customers.birth_date)
      `,
      )
      .run(params);
  }

  findByBusinessKey(id: string): Customer | undefined {
    const row = this.db
      .prepare("SELECT * FROM customers WHERE id = ?")
      .get(id) as CustomerRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  updateCorrection(
    id: string,
    input: {
      birthDate?: string;
      phone?: string;
    },
  ): Customer | undefined {
    const result = this.db
      .prepare(
        `
        UPDATE customers
        SET
          birth_date = COALESCE(@birthDate, birth_date),
          phone = COALESCE(@phone, phone)
        WHERE id = @id
      `,
      )
      .run({
        id,
        birthDate: input.birthDate ?? null,
        phone: input.phone ?? null,
      });
    return result.changes > 0 ? this.findByBusinessKey(id) : undefined;
  }

  list(): Customer[] {
    return (this.db.prepare("SELECT * FROM customers ORDER BY name").all() as CustomerRow[]).map(
      fromRow,
    );
  }
}
