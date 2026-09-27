# GUÍA INDIVIDUAL DE TRABAJO: ESCUADRÓN 6
## REPORTES FINANCIEROS, ANULACIÓN AUDITADA & PERIFÉRICOS POS
### DIPLOMADO DE OPCIÓN DE GRADO EN DESARROLLO DE SOFTWARE 4.0 (MÓDULOS 4 Y 5)
**Institución Universitaria del Putumayo - UniPutumayo (Sede Mocoa)**  
**Facultad de Tecnologías de la Información y la Comunicación**  
**Programa:** Tecnología en Desarrollo de Software (VI Semestre)  
**Docente Titular y Arquitecto Principal:** Anderson Stiven Moncayo Bermeo  
**Espacio de Trabajo:** Sala de Cómputo 121  

---

## 1. MISIÓN DE SU ESCUADRÓN
Ustedes son el centro de auditoría y control del SaaS. Su responsabilidad es calcular los informes financieros en tiempo real mediante consultas SQL agregadas garantizando la ecuación patrimonial ($Activo = Pasivo + Patrimonio$), ejecutar el flujo de **anulación auditada sin borrado físico** (emitiendo el contra-asiento contable y devolviendo el stock a bodega) y generar los comandos binarios crudos ESC/POS para impresión de tickets térmicos (58mm y 80mm) y apertura de cajón monedero.

---

## 2. ESTRUCTURA INTERNA DE SUS 4 INTEGRANTES (SCRUM AUTÓNOMO)
* **Integrante 1 (Squad Lead & Scrum Master):** Coordina con el Escuadrón 2 la generación de contra-asientos y con el Escuadrón 3 la devolución de inventario, moderando el Daily de 5 minutos.
* **Integrante 2 (Financial Reports Specialist):** Diseña y optimiza las consultas SQL agregadas para Balance General, Estado de Resultados (PyG) y Libro Mayor.
* **Integrante 3 (Audited Void & Reversal Specialist):** Codifica el caso de uso `VoidSaleService` que marca la factura como `VOIDED` y coordina la reversión contable y física.
* **Integrante 4 (Hardware & ESC/POS Specialist):** Programa el buffer de comandos binarios ESC/POS para impresoras térmicas USB/Bluetooth y pulso de solenoide para apertura de gaveta.

---

## 3. SUS DEPENDENCIAS TÉCNICAS
* **Qué necesitan de los demás:**
  * El Libro Diario del Escuadrón 2 para calcular los balances contables.
  * El inventario del Escuadrón 3 para reponer stock en caso de anulación.
  * Los comprobantes de venta del Escuadrón 4 y 5.
* **Qué le entregan a los demás:**
  * Endpoint `POST /api/v1/pos/sales/:id/void` para anular ventas con seguridad.
  * Endpoints `GET /api/v1/accounting/reports/balance-sheet` para la gerencia.
  * Generador de buffer ESC/POS para impresión de tirillas.

---

## 4. ESTRUCTURA HEXAGONAL DE SU CÓDIGO
Su código vive en `apps/api/src/modules/accounting/reports/` y `apps/api/src/modules/pos/void-sale/`:

```
apps/api/src/modules/
├── accounting/reports/
│   ├── application/reports.service.ts     <-- Balance General y PyG en SQL puro
│   └── infrastructure/reports.controller.ts
└── pos/void-sale/
    ├── application/void-sale.service.ts   <-- Anulacion y contra-asiento
    └── infrastructure/escpos.service.ts    <-- Comandos binarios para tickets
```

---

## 5. CÓDIGO DE PRODUCCIÓN LISTO PARA IMPLEMENTAR

### 1. Servicio de Balance General en SQL Puro (Validación de Ecuación Patrimonial)
```typescript
// apps/api/src/modules/accounting/reports.service.ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class FinancialReportsService {
  constructor(private readonly dataSource: DataSource) {}

  async getBalanceSheet(tenantId: string, cutOffDate: string) {
    const rawBalances = await this.dataSource.query(
      `SELECT 
        coa.code,
        coa.name,
        coa.account_type,
        coa.nature,
        COALESCE(SUM(jel.debit_amount), 0) AS total_debit,
        COALESCE(SUM(jel.credit_amount), 0) AS total_credit
       FROM chart_of_accounts coa
       LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id AND jel.tenant_id = $1
       LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.entry_date <= $2
       WHERE coa.tenant_id = $1 AND coa.account_type IN ('ACTIVO', 'PASIVO', 'PATRIMONIO')
       GROUP BY coa.code, coa.name, coa.account_type, coa.nature
       ORDER BY coa.code ASC`,
      [tenantId, cutOffDate]
    );

    let totalActivo = 0;
    let totalPasivo = 0;
    let totalPatrimonio = 0;

    const classifiedAccounts = rawBalances.map((acc: any) => {
      let balance = 0;
      const debit = parseFloat(acc.total_debit);
      const credit = parseFloat(acc.total_credit);

      if (acc.nature === 'D') {
        balance = debit - credit;
      } else {
        balance = credit - debit;
      }

      if (acc.account_type === 'ACTIVO') totalActivo += balance;
      if (acc.account_type === 'PASIVO') totalPasivo += balance;
      if (acc.account_type === 'PATRIMONIO') totalPatrimonio += balance;

      return {
        code: acc.code,
        name: acc.name,
        type: acc.account_type,
        balance,
      };
    });

    const equationDifference = totalActivo - (totalPasivo + totalPatrimonio);

    return {
      cutOffDate,
      summary: {
        totalActivo,
        totalPasivo,
        totalPatrimonio,
        equationValid: Math.abs(equationDifference) < 0.01,
        difference: equationDifference,
      },
      accounts: classifiedAccounts,
    };
  }
}
```

### 2. Servicio de Anulación Auditada con Contra-Asiento de Reversión
```typescript
// apps/api/src/modules/pos/void-sale.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class VoidSaleService {
  constructor(private readonly dataSource: DataSource) {}

  async voidInvoice(tenantId: string, invoiceId: string, reason: string, userId: string) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const invoice = await queryRunner.query(
        `SELECT id, invoice_number, status, journal_entry_id, branch_id
         FROM invoices WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, invoiceId]
      );

      if (invoice.length === 0) throw new NotFoundException('Comprobante no encontrado');
      if (invoice[0].status === 'VOIDED') throw new BadRequestException('El comprobante ya fue anulado');

      // 1. Marca de anulacion logica (Sin borrado fisico)
      await queryRunner.query(`UPDATE invoices SET status = 'VOIDED' WHERE id = $1`, [invoiceId]);

      // 2. Reposicion de inventario a bodega
      const items = await queryRunner.query(
        `SELECT product_id, quantity, unit_cost FROM invoice_items WHERE invoice_id = $1`,
        [invoiceId]
      );

      for (const item of items) {
        await queryRunner.query(
          `UPDATE stock_quants SET quantity_on_hand = quantity_on_hand + $1, updated_at = CURRENT_TIMESTAMP
           WHERE tenant_id = $2 AND product_id = $3`,
          [item.quantity, tenantId, item.product_id]
        );

        await queryRunner.query(
          `INSERT INTO stock_moves (tenant_id, product_id, warehouse_id, move_type, quantity, unit_cost, previous_stock, new_stock, reference_document, created_by)
           SELECT $1, $2, warehouse_id, 'VOID_RETURN', $3, $4, quantity_on_hand - $3, quantity_on_hand, $5, $6
           FROM stock_quants WHERE tenant_id = $1 AND product_id = $2 LIMIT 1`,
          [tenantId, item.product_id, item.quantity, item.unit_cost, `ANULACION-${invoice[0].invoice_number}`, userId]
        );
      }

      // 3. Contra-asiento contable invirtiendo debitos y creditos
      if (invoice[0].journal_entry_id) {
        const originalLines = await queryRunner.query(
          `SELECT account_id, third_party_id, description, debit_amount, credit_amount
           FROM journal_entry_lines WHERE journal_entry_id = $1`,
          [invoice[0].journal_entry_id]
        );

        const revEntry = await queryRunner.query(
          `INSERT INTO journal_entries (tenant_id, branch_id, concept, source_document_type, source_document_id, is_posted, created_by)
           VALUES ($1, $2, $3, 'REVERSAL', $4, TRUE, $5) RETURNING id`,
          [tenantId, invoice[0].branch_id, `Contra-asiento anulacion ${invoice[0].invoice_number}: ${reason}`, invoiceId, userId]
        );

        for (const line of originalLines) {
          await queryRunner.query(
            `INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, account_id, third_party_id, description, debit_amount, credit_amount)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              tenantId,
              revEntry[0].id,
              line.account_id,
              line.third_party_id,
              `Reversion: ${line.description}`,
              line.credit_amount, // Pasa a debito
              line.debit_amount,  // Pasa a credito
            ]
          );
        }
      }

      // 4. Registro inmutable en audit_logs
      await queryRunner.query(
        `INSERT INTO audit_logs (tenant_id, user_id, action, entity_name, entity_id, details)
         VALUES ($1, $2, 'INVOICE_VOIDED', 'invoices', $3, $4)`,
        [tenantId, userId, invoiceId, JSON.stringify({ reason, invoiceNumber: invoice[0].invoice_number })]
      );

      await queryRunner.commitTransaction();
      return { message: 'Factura anulada con exito y contra-asiento generado' };
    } catch (e) {
      await queryRunner.rollbackTransaction();
      throw e;
    } finally {
      await queryRunner.release();
    }
  }
}
```

---

## 6. CÓMO PRUEBAN SU TRABAJO DE FORMA DESACOPLADA
En `requests.http` ejecuten la anulación de una factura existente:
```http
POST http://localhost:3000/api/v1/pos/sales/ID_FACTURA/void
Authorization: Bearer {{token}}
Content-Type: application/json

{
  "reason": "Error en digitacion de cantidad por cajero"
}
```
Verifiquen en la base de datos que `invoices.status` sea `'VOIDED'` y que exista un nuevo asiento con débitos y créditos invertidos.

---

## 7. CHECKLIST PARA SUSTENTAR AL PROFESOR ANDERSON
Cuando el profesor se acerque a su puesto, deben mostrarle en menos de 60 segundos:
- [ ] Ejecutar `GET /api/v1/accounting/reports/balance-sheet` y mostrar que `summary.equationValid: true` con diferencia 0.00.
- [ ] Anular una venta y demostrar que el stock en bodega se incrementó y se emitió el contra-asiento correspondiente.
