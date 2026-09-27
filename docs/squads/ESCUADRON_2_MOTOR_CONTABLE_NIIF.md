# GUÍA INDIVIDUAL DE TRABAJO: ESCUADRÓN 2
## MOTOR CONTABLE & PARTIDA DOBLE NIIF (ACCOUNTING ENGINE)
### DIPLOMADO DE OPCIÓN DE GRADO EN DESARROLLO DE SOFTWARE 4.0 (MÓDULOS 4 Y 5)
**Institución Universitaria del Putumayo - UniPutumayo (Sede Mocoa)**  
**Facultad de Tecnologías de la Información y la Comunicación**  
**Programa:** Tecnología en Desarrollo de Software (VI Semestre)  
**Docente Titular y Arquitecto Principal:** Anderson Stiven Moncayo Bermeo  
**Espacio de Trabajo:** Sala de Cómputo 121  

---

## 1. MISIÓN DE SU ESCUADRÓN
Ustedes son el cerebro financiero del SaaS. Su responsabilidad es garantizar que cada movimiento comercial (ventas, compras, abonos, mermas) genere de forma **100% determinista y matemática** un asiento contable de partida doble en el Plan Único de Cuentas (PUC) colombiano. Si un asiento tiene una diferencia de 1 solo centavo, su código debe abortar la transacción. Prohibido el uso de IA: todo es lógica pura y determinista.

---

## 2. ESTRUCTURA INTERNA DE SUS 4 INTEGRANTES (SCRUM AUTÓNOMO)
* **Integrante 1 (Squad Lead & Scrum Master):** Coordina los contratos de causación contable con los líderes de Ventas (E4/E5) y Compras (E7), y modera el Daily de 5 minutos.
* **Integrante 2 (Ledger Engine Specialist):** Codifica la clase `AccountingService` con validación de balance $\sum Débitos - \sum Créditos = 0$ utilizando `decimal.js`.
* **Integrante 3 (PUC & Mapping Specialist):** Codifica los mapeos contables oficiales (110505 Caja, 130505 Clientes, 220505 Proveedores, 240805 IVA, 413505 Comercio, 613505 Costo).
* **Integrante 4 (QA & Audit Specialist):** Escribe pruebas unitarias con valores decimales extremos para demostrar que el sistema bloquea cualquier descuadre y genera contra-asientos reversibles exactos.

---

## 3. SUS DEPENDENCIAS TÉCNICAS
* **Qué necesitan de los demás:**
  * El contexto `tenant_id` y las tablas del Escuadrón 1.
  * El costo de la mercancía saliente del Escuadrón 3 para causar la cuenta 613505 (Costo de Ventas) contra 143505 (Inventarios).
* **Qué le entregan a los demás:**
  * Un servicio inyectable en memoria (`AccountingService`) que asienta ventas, compras y abonos.
  * La función de contra-asiento para que el Escuadrón 6 pueda anular facturas.
  * Las líneas del libro diario (`journal_entry_lines`) para que el Escuadrón 6 compile el Balance General.

---

## 4. ESTRUCTURA HEXAGONAL DE SU CÓDIGO
Su código vive en `apps/api/src/modules/accounting/`:

```
apps/api/src/modules/accounting/
├── domain/
│   └── entities/journal-entry.entity.ts
├── application/
│   ├── ports/
│   │   ├── in/create-entry.use-case.ts
│   │   └── out/accounting-repository.port.ts
│   └── services/accounting.service.ts
└── infrastructure/
    ├── adapters/
    │   ├── in/accounting.controller.ts
    │   └── out/postgres-accounting.repository.ts
    └── accounting.module.ts
```

---

## 5. CÓDIGO DE PRODUCCIÓN LISTO PARA IMPLEMENTAR

```typescript
// apps/api/src/modules/accounting/accounting.service.ts
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

  async createSaleJournalEntry(
    queryRunner: QueryRunner,
    tenantId: string,
    branchId: string,
    invoiceId: string,
    customerId: string,
    subtotal: number,
    taxTotal: number,
    grandTotal: number,
    paymentMethod: string,
    inventoryCostTotal: number,
    userId: string
  ): Promise<string> {
    const accounts = await queryRunner.query(
      `SELECT id, code FROM chart_of_accounts 
       WHERE tenant_id = $1 AND code IN ('110505', '130505', '413505', '240805', '613505', '143505')`,
      [tenantId]
    );

    const accountMap = new Map<string, string>();
    accounts.forEach((acc: any) => accountMap.set(acc.code, acc.id));

    const debitAccountCode = paymentMethod === 'CREDITO_FIADO' ? '130505' : '110505';

    const lines: EntryLineInput[] = [
      {
        accountId: accountMap.get(debitAccountCode)!,
        thirdPartyId: customerId,
        description: `Venta POS Factura ${invoiceId}`,
        debitAmount: grandTotal,
        creditAmount: 0,
      },
      {
        accountId: accountMap.get('413505')!,
        thirdPartyId: customerId,
        description: 'Ingreso por venta comercial',
        debitAmount: 0,
        creditAmount: subtotal,
      },
    ];

    if (taxTotal > 0) {
      lines.push({
        accountId: accountMap.get('240805')!,
        thirdPartyId: customerId,
        description: 'IVA generado (19%)',
        debitAmount: 0,
        creditAmount: taxTotal,
      });
    }

    if (inventoryCostTotal > 0) {
      lines.push(
        {
          accountId: accountMap.get('613505')!,
          description: 'Costo de mercancia vendida',
          debitAmount: inventoryCostTotal,
          creditAmount: 0,
        },
        {
          accountId: accountMap.get('143505')!,
          description: 'Salida de inventario por venta',
          debitAmount: 0,
          creditAmount: inventoryCostTotal,
        }
      );
    }

    return this.createImmutableJournalEntry(
      queryRunner,
      tenantId,
      branchId,
      `Causacion automatica Venta POS ${invoiceId}`,
      'SALE_POS',
      invoiceId,
      lines,
      userId
    );
  }
}
```

---

## 6. CÓMO PRUEBAN SU TRABAJO DE FORMA DESACOPLADA
En `requests.http` ejecuten una prueba de asiento forzado con un centavo de diferencia:
```http
POST http://localhost:3000/api/v1/accounting/journal-entries/manual
Authorization: Bearer {{token}}
Content-Type: application/json

{
  "concept": "Prueba descuadre",
  "lines": [
    { "accountId": "ID_CAJA", "debitAmount": 100000.00, "creditAmount": 0 },
    { "accountId": "ID_COMERCIO", "debitAmount": 0, "creditAmount": 99999.99 }
  ]
}
```
*Respuesta esperada:* `400 Bad Request: Descuadre contable detectado`.

---

## 7. CHECKLIST PARA SUSTENTAR AL PROFESOR ANDERSON
Cuando el profesor se acerque a su puesto, deben mostrarle en menos de 60 segundos:
- [ ] Ejecutar una consulta SQL sobre `journal_entry_lines` del último asiento de venta y mostrar:
  `SUM(debit_amount) - SUM(credit_amount) = 0.00`.
- [ ] Mostrar en el código que los asientos en estado `POSTED` no tienen sentencia `UPDATE` ni `DELETE` (inmutabilidad estricta).
