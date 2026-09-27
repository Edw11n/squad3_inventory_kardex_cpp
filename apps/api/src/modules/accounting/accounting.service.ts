import { Injectable, BadRequestException } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import Decimal from 'decimal.js';

export interface EntryLineInput {
  accountId: string;
  thirdPartyId?: string;
  description: string;
  debitAmount: number;
  creditAmount: number;
}

@Injectable()
export class AccountingService {
  constructor(private readonly dataSource: DataSource) {}

  async createImmutableJournalEntry(
    queryRunner: QueryRunner,
    tenantId: string,
    branchId: string,
    concept: string,
    sourceDocumentType: string,
    sourceDocumentId: string,
    lines: EntryLineInput[],
    userId?: string
  ): Promise<string> {
    if (!lines || lines.length < 2) {
      throw new BadRequestException('Un asiento contable requiere al menos dos lineas');
    }

    let sumDebits = new Decimal(0);
    let sumCredits = new Decimal(0);

    for (const line of lines) {
      const debit = new Decimal(line.debitAmount || 0);
      const credit = new Decimal(line.creditAmount || 0);

      if (debit.isNegative() || credit.isNegative()) {
        throw new BadRequestException('Los valores de debito o credito no pueden ser negativos');
      }

      if (debit.isPositive() && credit.isPositive()) {
        throw new BadRequestException('Una linea no puede tener debito y credito simultaneamente');
      }

      sumDebits = sumDebits.plus(debit);
      sumCredits = sumCredits.plus(credit);
    }

    const difference = sumDebits.minus(sumCredits).abs();
    if (!difference.isZero()) {
      throw new BadRequestException(
        `Descuadre contable detectado. Debitos: ${sumDebits.toFixed(2)}, Creditos: ${sumCredits.toFixed(2)}, Diferencia: ${difference.toFixed(2)}`
      );
    }

    const entryResult = await queryRunner.query(
      `INSERT INTO journal_entries (
        tenant_id, branch_id, concept, source_document_type,
        source_document_id, is_posted, created_by
      ) VALUES ($1, $2, $3, $4, $5, TRUE, $6)
      RETURNING id, entry_number`,
      [tenantId, branchId, concept, sourceDocumentType, sourceDocumentId, userId]
    );

    const journalEntryId = entryResult[0].id;

    for (const line of lines) {
      await queryRunner.query(
        `INSERT INTO journal_entry_lines (
          tenant_id, journal_entry_id, account_id, third_party_id,
          description, debit_amount, credit_amount
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          tenantId,
          journalEntryId,
          line.accountId,
          line.thirdPartyId || null,
          line.description,
          line.debitAmount,
          line.creditAmount,
        ]
      );
    }

    return journalEntryId;
  }
}
