# Sistema SaaS Empresarial Contable, POS y Gestión Comercial Multi-Tenant
## Diplomado de Opción de Grado en Desarrollo de Software 4.0 (Módulos 4 y 5)
**Institución Universitaria del Putumayo - UniPutumayo (Sede Mocoa)**  
**Facultad de Tecnologías de la Información y la Comunicación**  
**Docente Titular y Arquitecto Principal:** Anderson Stiven Moncayo Bermeo  
**Espacio de Trabajo:** Sala de Cómputo 121  
**Población:** 32 Estudiantes (8 Escuadrones de Ingeniería)  

---

## 1. Reglas Sagradas del Proyecto

1. **Cero Inteligencia Artificial y Cero OCR:** El sistema es 100% transaccional, determinista y auditado. No hay modelos predictivos ni lectura óptica de facturas.
2. **Inmutabilidad Financiera NIIF:** Prohibido el borrado destructivo (`DELETE`) en asientos o inventarios. Las correcciones se hacen mediante contra-asientos de reversión.
3. **Delimitación Fiscal:** El sistema gestiona **Facturación Comercial Interna, Comprobantes POS y Recibos de Caja**. No incluye facturación electrónica DIAN externa.
4. **Aislamiento Multi-Tenant Estricto:** Forzado en PostgreSQL 16 con Row Level Security (RLS) e inyección de `SET LOCAL app.current_tenant_id`.

---

## 2. Instrucciones de Arranque Rápido (Sala 121)

### Paso 1: Clonar y configurar entorno
```bash
git clone https://github.com/AndersonMoncayo/saas-contable-uniputumayo.git
cd saas-contable-uniputumayo
cp .env.example .env
pnpm install
```

### Paso 2: Iniciar Infraestructura Docker
```bash
docker compose up -d
docker compose ps
```
Verificar que `postgres-saas` (puerto 5432) y `redis-saas` (puerto 6379) reporten estado `healthy`.

### Paso 3: Compilar Contratos Centrales
```bash
pnpm --filter @saas/contracts build
```

### Paso 4: Ejecutar según tu Escuadrón
* **Escuadrones Backend (1, 2, 3, 6, 7):**
  ```bash
  pnpm db:migrate
  pnpm db:seed
  pnpm --filter api dev
  ```
  Swagger UI interactivo disponible en: `http://localhost:3000/api/docs`.

* **Escuadrón 4 (Web Desktop POS):**
  Levantar el Mock Server en una terminal:
  ```bash
  pnpm mock:server
  ```
  En otra terminal, iniciar Next.js 15:
  ```bash
  pnpm --filter web dev
  ```
  Acceso en: `http://localhost:4000/pos`.

* **Escuadrón 5 (Mobile POS Flutter):**
  ```bash
  cd apps/mobile
  flutter pub get
  flutter run
  ```

---

## 3. Guías Específicas por Escuadrón
Las guías de desarrollo individuales se encuentran en la carpeta `docs/squads/`:
* `docs/squads/ESCUADRON_1_CORE_RLS_USUARIOS.md`
* `docs/squads/ESCUADRON_2_MOTOR_CONTABLE_NIIF.md`
* `docs/squads/ESCUADRON_3_INVENTARIO_KARDEX_CPP.md`
* `docs/squads/ESCUADRON_4_WEB_DESKTOP_POS_NEXTJS.md`
* `docs/squads/ESCUADRON_5_MOBILE_POS_FLUTTER_OFFLINE.md`
* `docs/squads/ESCUADRON_6_REPORTES_ANULACION_PERIFERICOS.md`
* `docs/squads/ESCUADRON_7_COMPRAS_PROVEEDORES_FIADOS.md`
* `docs/squads/ESCUADRON_8_DEVOPS_INFRAESTRUCTURA_QA.md`
