# GUÍA INDIVIDUAL DE TRABAJO: ESCUADRÓN 8
## DEVOPS, SRE, INFRAESTRUCTURA UNIVERSAL & QA AUTOMATION
### DIPLOMADO DE OPCIÓN DE GRADO EN DESARROLLO DE SOFTWARE 4.0 (MÓDULOS 4 Y 5)
**Institución Universitaria del Putumayo - UniPutumayo (Sede Mocoa)**  
**Facultad de Tecnologías de la Información y la Comunicación**  
**Programa:** Tecnología en Desarrollo de Software (VI Semestre)  
**Docente Titular y Arquitecto Principal:** Anderson Stiven Moncayo Bermeo  
**Espacio de Trabajo:** Sala de Cómputo 121  


## 0. REPOSITORIO CENTRAL OFICIAL DEL PROYECTO
Todos los integrantes del escuadrón deben clonar el repositorio central en GitHub y crear su rama de trabajo:

```bash
# 1. Clonar el repositorio oficial
git clone https://github.com/AndersonMoncayo/saas-contable-uniputumayo.git
cd saas-contable-uniputumayo

# 2. Configurar variables e instalar dependencias
cp .env.example .env
pnpm install

# 3. Iniciar infraestructura de base de datos y cache
docker compose up -d

# 4. Crear la rama oficial de su escuadron (NUNCA hacer commits en main)
git checkout -b squad-8/feature-nombre-modulo
```

---

## 1. MISIÓN DE SU ESCUADRÓN
Ustedes son los guardianes de la infraestructura, estabilidad y rendimiento del sistema. Su responsabilidad es garantizar que PostgreSQL 16 y Redis 7 inicien en estado `healthy` en todas las computadoras de la Sala 121 con un solo comando, proteger la rama principal `main` en GitHub configurando el pipeline de Integración Continua (CI), y certificar el rendimiento mediante pruebas de carga con K6 simulando **50 cajeros concurrentes con latencia media < 300 ms**.

---

## 2. ESTRUCTURA INTERNA DE SUS 4 INTEGRANTES (SCRUM AUTÓNOMO)
* **Integrante 1 (Squad Lead & Scrum Master):** Monitorea que las estaciones de trabajo de los 8 escuadrones tengan Docker corriendo sin colisiones de puertos y modera el Daily de 5 minutos.
* **Integrante 2 (Docker & Infrastructure Specialist):** Mantiene el archivo `docker-compose.yml`, los Dockerfiles multi-stage y las políticas de reinicio automático y healthchecks.
* **Integrante 3 (CI/CD Pipeline Specialist):** Configura los workflows de GitHub Actions (`.github/workflows/ci.yml`) para compilar contratos y ejecutar suites de pruebas unitarias en cada Pull Request.
* **Integrante 4 (SRE & Performance Specialist):** Diseña y ejecuta los scripts de pruebas de carga en K6 simulando concurrencia extrema en los endpoints de checkout del POS.

---

## 3. SUS DEPENDENCIAS TÉCNICAS
* **Qué necesitan de los demás:** El código fuente de las aplicaciones (`apps/api`, `apps/web`, `apps/mobile`) para ejecutar los pipelines de prueba.
* **Qué le entregan a los demás:**
  * El entorno de persistencia reproducible con Docker Compose (`postgres-saas` y `redis-saas`).
  * El reporte de estado del pipeline de CI para autorizar fusiones de Pull Requests.
  * El informe de latencia y pruebas de carga con K6.

---

## 4. ESTRUCTURA DE ARCHIVOS DE SU CÓDIGO
Su código vive en la raíz y en la carpeta de pruebas:

```
saas-contable-uniputumayo/
├── docker-compose.yml                     <-- Orquestacion Postgres + Redis
├── .github/
│   └── workflows/
│       └── ci.yml                         <-- Pipeline de pruebas automaticas
└── tests/
    └── k6/
        └── load-test-pos.js               <-- Script de estres para 50 cajeros
```

---

## 5. CÓDIGO DE PRODUCCIÓN LISTO PARA IMPLEMENTAR

### 1. Archivo Docker Compose de Infraestructura Universal
```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: postgres-saas
    restart: always
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-saas_admin}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-uniputumayo2026}
      POSTGRES_DB: ${POSTGRES_DB:-saas_contable_db}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-saas_admin} -d ${POSTGRES_DB:-saas_contable_db}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7.2-alpine
    container_name: redis-saas
    restart: always
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```

### 2. Pipeline de CI/CD en GitHub Actions
```yaml
# .github/workflows/ci.yml
name: CI Multi-Tenant SaaS Pipeline

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  validate:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: saas_admin
          POSTGRES_PASSWORD: uniputumayo2026
          POSTGRES_DB: saas_contable_db
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7.2-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js 20 LTS
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install pnpm
        uses: pnpm/action-setup@v3
        with:
          version: 9

      - name: Install Monorepo Dependencies
        run: pnpm install

      - name: Build Shared Contracts
        run: pnpm --filter @saas/contracts build

      - name: Run Database Migrations
        run: pnpm db:migrate
        env:
          DATABASE_URL: postgresql://saas_admin:uniputumayo2026@localhost:5432/saas_contable_db

      - name: Execute Backend Tests
        run: pnpm --filter api test
        env:
          DATABASE_URL: postgresql://saas_admin:uniputumayo2026@localhost:5432/saas_contable_db
          REDIS_URL: redis://localhost:6379
```

### 3. Script de Pruebas de Carga en K6 (50 Cajeros Concurrentes)
```javascript
// tests/k6/load-test-pos.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '2m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000/api/v1';
const TOKEN = __ENV.AUTH_TOKEN || 'mock-token';

export default function () {
  const payload = JSON.stringify({
    branchId: '00000000-0000-0000-0000-000000000001',
    paymentMethod: 'EFECTIVO',
    cashTendered: 100000,
    items: [
      {
        productId: '00000000-0000-0000-0000-000000000002',
        quantity: 2,
        unitPrice: 32000,
      },
    ],
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      'X-Idempotency-Key': `k6-${__VU}-${__ITER}-${Date.now()}`,
    },
  };

  const response = http.post(`${BASE_URL}/pos/checkout`, payload, params);

  check(response, {
    'Estado HTTP es 201 Creado': (r) => r.status === 201,
    'Latencia de cobro menor a 300ms': (r) => r.timings.duration < 300,
  });

  sleep(1);
}
```

---

## 6. CÓMO PRUEBAN SU TRABAJO DE FORMA DESACOPLADA
1. Verifiquen la salud de los contenedores en terminal:
   ```b`ash
   docker compose ps
   ```
2. Ejecuten el test de carga en K6:
   ```b`ash
   k6 run tests/k6/load-test-pos.js
   ```
   Comprueben que la métrica `http_req_duration` muestre `p(95) < 300ms`.

---

## 7. CHECKLIST PARA SUSTENTAR AL PROFESOR ANDERSON
Cuando el profesor se acerque a su puesto, deben mostrarle en menos de 60 segundos:
- [ ] La salida de `docker compose ps` con PostgreSQL y Redis en estado `healthy`.
- [ ] El terminal de GitHub Actions o ejecución local mostrando las pruebas pasando al 100% y el reporte de K6 con latencia < 300ms.

