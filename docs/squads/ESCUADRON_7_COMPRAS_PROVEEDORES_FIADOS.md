# GUÍA INDIVIDUAL DE TRABAJO: ESCUADRÓN 7
## MÓDULO DE COMPRAS, PROVEEDORES, CARTERA & GESTIÓN DE "FIADOS"
### DIPLOMADO DE OPCIÓN DE GRADO EN DESARROLLO DE SOFTWARE 4.0 (MÓDULOS 4 Y 5)
**Institución Universitaria del Putumayo - UniPutumayo (Sede Mocoa)**  
**Facultad de Tecnologías de la Información y la Comunicación**  
**Programa:** Tecnología en Desarrollo de Software (VI Semestre)  
**Docente Titular y Arquitecto Principal:** Anderson Stiven Moncayo Bermeo  
**Espacio de Trabajo:** Sala de Cómputo 121  

---

## 1. MISIÓN DE SU ESCUADRÓN
Ustedes construyen el corazón comercial estilo Treinta Pro para empresas formalmente constituidas. Su responsabilidad es controlar los límites máximos de crédito a clientes fiados (impidiendo ventas que superen el cupo autorizado), registrar los abonos parciales emitiendo el recibo de caja menor para WhatsApp con su causación contable inmediata, gestionar la recepción formal de facturas de compra a proveedores (actualizando inventarios y cuentas por pagar 220505) y compilar el reporte de cartera vencida por edades.

---

## 2. ESTRUCTURA INTERNA DE SUS 4 INTEGRANTES (SCRUM AUTÓNOMO)
* **Integrante 1 (Squad Lead & Scrum Master):** Coordina con el POS (E4 y E5) el endpoint de consulta de cupo fiado y con Inventarios (E3) la recepción de mercancía, moderando el Daily de 5 minutos.
* **Integrante 2 (Credit Limit & Fiados Specialist):** Codifica las validaciones de crédito `current_debt + sale <= credit_limit` y el libro inmutable de `credit_transactions`.
* **Integrante 3 (Purchases & Supplier Specialist):** Codifica el registro de compras a proveedores con validación de factura única (`uq_tenant_supplier_inv`).
* **Integrante 4 (QA & Portfolio Specialist):** Escribe pruebas unitarias que intentan realizar ventas fiadas por encima del cupo autorizado y valida la consulta SQL de cartera por edades.

---

## 3. SUS DEPENDENCIAS TÉCNICAS
* **Qué necesitan de los demás:**
  * El contexto `tenant_id` y las tablas de terceros del Escuadrón 1.
  * La función de recepción de inventario del Escuadrón 3 para recalcular el CPP al asentar una compra.
  * El servicio del Escuadrón 2 para causar asientos contables de compra y abonos.
* **Qué le entregan a los demás:**
  * Endpoint `GET /api/v1/credits/customers` para que el POS muestre el saldo fiado y cupo disponible del cliente seleccionado (`F4`).
  * Endpoint `POST /api/v1/credits/customers/:id/payments` para cobrar abonos en caja o en ruta móvil.
  * El reporte de cartera vencida por edades (`GET /api/v1/credits/aging-report`).

---

## 4. ESTRUCTURA HEXAGONAL DE SU CÓDIGO
Su código vive en `apps/api/src/modules/credits/` y `apps/api/src/modules/purchases/`:

```
apps/api/src/modules/
├── credits/
│   ├── application/credits.service.ts     <-- Fiados, limites y abonos
│   └── infrastructure/credits.controller.ts
└── purchases/
    ├── application/purchases.service.ts   <-- Compras a proveedores
    └── infrastructure/purchases.controller.ts
```

---

## 5. CÓDIGO DE PRODUCCIÓN LISTO PARA IMPLEMENTAR

```typescript
// apps/api/src/modules/credits/credits.service.ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class CreditsService {
  constructor(private readonly dataSource: DataSource) {}

  async validateAndChargeCreditSale(queryRunner: any, tenantId: string, customerId: string, amount: number, userId: string) {
    const customer = await queryRunner.query(
      `SELECT id, name, credit_limit, current_debt FROM third_parties WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, customerId]
    );

    if (customer.length === 0) throw new NotFoundException('Cliente fiado no encontrado');

    const debt = parseFloat(customer[0].current_debt);
    const limit = parseFloat(customer[0].credit_limit);

    if (debt + amount > limit) {
      throw new BadRequestException(`Cupo de credito excedido. Limite: $${limit}, Deuda actual: $${debt}, Venta requerida: $${amount}`);
    }

    const newDebt = debt + amount;
    await queryRunner.query(`UPDATE third_parties SET current_debt = $1 WHERE id = $2`, [newDebt, customerId]);

    await queryRunner.query(
      `INSERT INTO credit_transactions (tenant_id, third_party_id, transaction_type, amount, balance_after, created_by)
       VALUES ($1, $2, 'CHARGE_CREDIT_SALE', $3, $4, $5)`,
      [tenantId, customerId, amount, newDebt, userId]
    );
  }

  async recordCustomerPayment(tenantId: string, branchId: string, customerId: string, amount: number, paymentMethod: string, userId: string) {
    if (amount <= 0) throw new BadRequestException('El valor del abono debe ser mayor a cero');

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const customer = await queryRunner.query(
        `SELECT id, name, current_debt FROM third_parties WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, customerId]
      );
      if (customer.length === 0) throw new NotFoundException('Cliente no encontrado');

      const debt = parseFloat(customer[0].current_debt);
      if (amount > debt) throw new BadRequestException(`El abono ($${amount}) supera la deuda actual ($${debt})`);

      const newDebt = debt - amount;
      await queryRunner.query(`UPDATE third_parties SET current_debt = $1 WHERE id = $2`, [newDebt, customerId]);

      const trans = await queryRunner.query(
        `INSERT INTO credit_transactions (tenant_id, third_party_id, transaction_type, amount, balance_after, payment_method, created_by)
         VALUES ($1, $2, 'CUSTOMER_PAYMENT', $3, $4, $5, $6) RETURNING id`,
        [tenantId, customerId, amount, newDebt, paymentMethod, userId]
      );

      const accounts = await queryRunner.query(
        `SELECT id, code FROM chart_of_accounts WHERE tenant_id = $1 AND code IN ('110505', '130505')`,
        [tenantId]
      );
      const cashAcc = accounts.find((a: any) => a.code === '110505');
      const clientAcc = accounts.find((a: any) => a.code === '130505');

      const entry = await queryRunner.query(
        `INSERT INTO journal_entries (tenant_id, branch_id, concept, source_document_type, source_document_id, is_posted, created_by)
         VALUES ($1, $2, $3, 'CUSTOMER_PAYMENT', $4, TRUE, $5) RETURNING id`,
        [tenantId, branchId, `Abono fiado: ${customer[0].name}`, trans[0].id, userId]
      );

      await queryRunner.query(
        `INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, account_id, third_party_id, description, debit_amount, credit_amount)
         VALUES 
         ($1, $2, $3, $4, 'Recaudo de cartera', $5, 0.00),
         ($1, $2, $6, $4, 'Disminucion cuenta por cobrar clientes', 0.00, $5)`,
        [tenantId, entry[0].id, cashAcc.id, customerId, amount, clientAcc.id]
      );

      await queryRunner.commitTransaction();

      return {
        paymentId: trans[0].id,
        customerName: customer[0].name,
        amountPaid: amount,
        previousDebt: debt,
        balanceAfter: newDebt,
      };
    } catch (e) {
      await queryRunner.rollbackTransaction();
      throw e;
    } finally {
      await queryRunner.release();
    }
  }

  async getAgingReport(tenantId: string) {
    return this.dataSource.query(
      `SELECT 
        tp.id,
        tp.document_number,
        tp.name,
        tp.phone,
        tp.credit_limit,
        tp.current_debt,
        COALESCE(SUM(CASE WHEN DATE_PART('day', NOW() - ct.created_at) <= 30 THEN ct.amount ELSE 0 END), 0) AS bucket_0_30,
        COALESCE(SUM(CASE WHEN DATE_PART('day', NOW() - ct.created_at) BETWEEN 31 AND 60 THEN ct.amount ELSE 0 END), 0) AS bucket_31_60,
        COALESCE(SUM(CASE WHEN DATE_PART('day', NOW() - ct.created_at) BETWEEN 61 AND 90 THEN ct.amount ELSE 0 END), 0) AS bucket_61_90,
        COALESCE(SUM(CASE WHEN DATE_PART('day', NOW() - ct.created_at) > 90 THEN ct.amount ELSE 0 END), 0) AS bucket_over_90
       FROM third_parties tp
       LEFT JOIN credit_transactions ct ON ct.third_party_id = tp.id AND ct.transaction_type = 'CHARGE_CREDIT_SALE'
       WHERE tp.tenant_id = $1 AND tp.party_type IN ('CUSTOMER', 'BOTH') AND tp.current_debt > 0
       GROUP BY tp.id, tp.document_number, tp.name, tp.phone, tp.credit_limit, tp.current_debt
       ORDER BY tp.current_debt DESC`,
      [tenantId]
    );
  }
}
```

---

## 6. CÓMO PRUEBAN SU TRABAJO DE FORMA DESACOPLADA
En `requests.http` prueben el registro de un abono parcial a un cliente fiado:
```http
POST http://localhost:3000/api/v1/credits/customers/ID_CLIENTE/payments
Authorization: Bearer {{token}}
Content-Type: application/json

{
  "amount": 50000.00,
  "paymentMethod": "EFECTIVO"
}
```
Verifiquen que el endpoint responda con el saldo anterior, el monto pagado y el nuevo saldo restante, y que en contabilidad se haya debitado Caja (110505) y acreditado Clientes (130505).

---

## 7. CHECKLIST PARA SUSTENTAR AL PROFESOR ANDERSON
Cuando el profesor se acerque a su puesto, deben mostrarle en menos de 60 segundos:
- [ ] Intentar una venta fiada que supere el cupo asignado del cliente y mostrar que la API responde `400 Cupo de credito excedido`.
- [ ] Ejecutar `GET /api/v1/credits/aging-report` y mostrar la cartera clasificada en los 4 buckets (corriente, 30, 60 y >90 días).
