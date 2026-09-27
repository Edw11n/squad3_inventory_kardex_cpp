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

    const existing = await this.dataSource.query(
      `SELECT id FROM users WHERE tenant_id = $1 AND (email = $2 OR document_number = $3)`,
      [tenantId, dto.email, dto.documentNumber]
    );

    if (existing.length > 0) {
      throw new ConflictException('Ya existe un colaborador con este documento o correo');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

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

    await this.redisClient.del(`user_sessions:${userId}`);
    return { message: `Colaborador actualizado a ${isActive ? 'ACTIVO' : 'INACTIVO'}` };
  }
}
