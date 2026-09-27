# GUÍA INDIVIDUAL DE TRABAJO: ESCUADRÓN 1
## CORE ARCHITECTURE, MULTI-TENANCY, GESTIÓN DE PERSONAL & RBAC
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
git checkout -b squad-1/feature-nombre-modulo
```

---

## 1. MISIÓN DE SU ESCUADRÓN
Ustedes son el cimiento de seguridad del sistema. Su responsabilidad es garantizar que ninguna empresa pueda ver los datos de otra empresa mediante Row Level Security (RLS) en PostgreSQL 16, gestionar el ciclo de vida del personal con política *Soft-Disable* (cero `DELETE FROM users`) y controlar la revocación de sesiones en Redis.

---

## 2. ESTRUCTURA INTERNA DE SUS 4 INTEGRANTES (SCRUM AUTÓNOMO)
* **Integrante 1 (Squad Lead & Scrum Master):** Administra el tablero de GitHub de su escuadrón, lidera el Daily de 5 minutos al inicio de clase y coordina con el Escuadrón 8 la ejecución de migraciones.
* **Integrante 2 (Backend Core Specialist):** Codifica las políticas RLS en SQL y el interceptor de sesión `TenantInterceptor`.
* **Integrante 3 (Users & RBAC Specialist):** Codifica el servicio de personal, hashing con bcrypt y el guard de roles (`RolesGuard`).
* **Integrante 4 (QA & Security Specialist):** Escribe las pruebas automatizadas que intentan consultar datos con un tenant ajeno para validar que la base de datos devuelva cero filas.

---

## 3. SUS DEPENDENCIAS TÉCNICAS
* **Qué necesitan de los demás:** El contenedor de PostgreSQL 16 y Redis 7 levantado por el Escuadrón 8 (`docker compose up -d`).
* **Qué le entregan a los demás:**
  * El middleware/interceptor que inyecta `SET LOCAL app.current_tenant_id`.
  * La tabla `users`, `branches`, `tenants` y `audit_logs`.
  * Los tokens JWT con los claims `tenantId` y `role`.

---

## 4. ESTRUCTURA HEXAGONAL DE SU CÓDIGO
Su código vive en `apps/api/src/modules/users/` y `apps/api/src/common/`:

```
apps/api/src/
├── common/
│   ├── decorators/roles.decorator.ts
│   ├── guards/roles.guard.ts
│   └── interceptors/tenant.interceptor.ts
└── modules/users/
    ├── domain/entities/user.entity.ts
    ├── application/ports/out/user-repository.port.ts
    ├── infrastructure/
    │   ├── adapters/in/users.controller.ts
    │   └── adapters/out/postgres-user.repository.ts
    └── users.module.ts
```

---

## 5. CÓDIGO DE PRODUCCIÓN LISTO PARA IMPLEMENTAR

### 1. Interceptor de Sesión Transaccional RLS en PostgreSQL
```typescript
// apps/api/src/common/interceptors/tenant.interceptor.ts
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  UnauthorizedException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { DataSource } from 'typeorm';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly dataSource: DataSource) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.tenantId) {
      throw new UnauthorizedException('Identificador tenantId no encontrado en la sesion');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      await queryRunner.query(`SET LOCAL app.current_tenant_id = '${user.tenantId}'`);
      request.queryRunner = queryRunner;
      return next.handle();
    } catch (error) {
      await queryRunner.release();
      throw error;
    }
  }
}
```

### 2. Guard de Roles RBAC
```typescript
// apps/api/src/common/guards/roles.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user || !user.role) throw new ForbiddenException('Usuario no autenticado o sin rol');

    const hasPermission = requiredRoles.includes(user.role);
    if (!hasPermission) {
      throw new ForbiddenException(`Acceso denegado: El rol ${user.role} no tiene permisos suficientes`);
    }

    return true;
  }
}
```

### 3. Servicio de Personal con Revocación en Redis
```typescript
// apps/api/src/modules/users/users.service.ts
import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import Redis from 'ioredis';

@Injectable()
export class UsersService {
  private redisClient: Redis;

  constructor(private readonly dataSource: DataSource) {
    this.redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  }

  async createUser(tenantId: string, dto: any) {
    if (dto.role === 'OWNER') {
      throw new BadRequestException('El rol OWNER unicamente se asigna durante el registro del tenant');
    }

    const duplicateCheck = await this.dataSource.query(
      `SELECT id FROM users WHERE tenant_id = $1 AND (email = $2 OR document_number = $3)`,
      [tenantId, dto.email, dto.documentNumber]
    );

    if (duplicateCheck.length > 0) {
      throw new ConflictException('Ya existe un colaborador con este documento o correo');
    }

    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(dto.password, saltRounds);

    const result = await this.dataSource.query(
      `INSERT INTO users (
        tenant_id, branch_id, document_type, document_number, email,
        password_hash, full_name, phone, role, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
      RETURNING id, document_number, email, full_name, role, is_active`,
      [tenantId, dto.branchId, dto.documentType || 'CC', dto.documentNumber, dto.email, passwordHash, dto.fullName, dto.phone, dto.role]
    );

    return result[0];
  }

  async updateUserStatus(tenantId: string, userId: string, isActive: boolean) {
    const user = await this.dataSource.query(
      `SELECT id, role FROM users WHERE tenant_id = $1 AND id = $2`,
      [tenantId, userId]
    );

    if (user.length === 0) throw new NotFoundException('Colaborador no encontrado');
    if (user[0].role === 'OWNER') throw new BadRequestException('El usuario OWNER no puede ser desactivado');

    await this.dataSource.query(
      `UPDATE users SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $2 AND id = $3`,
      [isActive, tenantId, userId]
    );

    // Expulsa tokens activos de Redis
    await this.redisClient.del(`user_sessions:${userId}`);
    return { message: `Colaborador actualizado a ${isActive ? 'ACTIVO' : 'INACTIVO'}` };
  }
}
```

---

## 6. CÓMO PRUEBAN SU TRABAJO DE FORMA DESACOPLADA
1. Abran su navegador en `http://localhost:3000/api/docs`.
2. Vayan a `POST /api/v1/auth/login`, obtengan el token del usuario `admin@ferreputumayo.co`.
3. Presionen **Authorize** y peguen el token.
4. Vayan a `POST /api/v1/users`, creen un cajero con cédula nueva.
5. Vuelvan a intentar crearlo con la misma cédula: debe responder `409 Conflict`.

---

## 7. CHECKLIST PARA SUSTENTAR AL PROFESOR ANDERSON
Cuando el profesor se acerque a su puesto, deben mostrarle en menos de 60 segundos:
- [ ] Ejecutar una consulta en la terminal con un token de la Empresa A consultando un ID de la Empresa B y demostrar que PostgreSQL responde 0 registros gracias a RLS.
- [ ] Desactivar un cajero con `PATCH /api/v1/users/:id/status` y mostrar que su sesión en Redis fue borrada.

