-- =====================================================================
-- SEMILLERO OFICIAL - SAAS CONTABLE UNIPUTUMAYO (SALA 121)
-- =====================================================================

-- 1. Inquilino de Prueba (Ferreteria y Materiales del Putumayo S.A.S.)
INSERT INTO tenants (id, nit_rut, business_name, trade_name, address, phone, email)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    '901.854.123-1',
    'Ferreteria y Materiales del Putumayo S.A.S.',
    'Ferreteria del Putumayo',
    'Calle 10 # 8-45 Centro, Mocoa, Putumayo',
    '3124567890',
    'contacto@ferreputumayo.co'
) ON CONFLICT (nit_rut) DO NOTHING;

-- 2. Sucursal Centro
INSERT INTO branches (id, tenant_id, code, name, address, phone)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    'SUC01',
    'Sucursal Principal Centro',
    'Calle 10 # 8-45, Mocoa',
    '3124567890'
) ON CONFLICT (tenant_id, code) DO NOTHING;

-- 3. Bodega Principal
INSERT INTO warehouses (id, tenant_id, branch_id, code, name)
VALUES (
    '00000000-0000-0000-0000-000000000010',
    '11111111-1111-1111-1111-111111111111',
    '00000000-0000-0000-0000-000000000001',
    'BOD01',
    'Bodega Central Mocoa'
) ON CONFLICT (tenant_id, code) DO NOTHING;

-- 4. Usuario Administrador (OWNER)
-- Clave por defecto: Password123* (bcrypt hash)
INSERT INTO users (id, tenant_id, branch_id, document_type, document_number, email, password_hash, full_name, phone, role)
VALUES (
    '00000000-0000-0000-0000-000000000100',
    '11111111-1111-1111-1111-111111111111',
    '00000000-0000-0000-0000-000000000001',
    'CC',
    '1061808735',
    'admin@ferreputumayo.co',
    '$2b$12$e8p.KxJt/iZJ9R5xH9Wqre06M7q7lR3uG2U.4sR8K1M7k7h9j0m2O',
    'Anderson Stiven Moncayo Bermeo',
    '3100000000',
    'OWNER'
) ON CONFLICT (tenant_id, email) DO NOTHING;

-- 5. Tercero de Prueba (Cliente con cupo fiado)
INSERT INTO third_parties (id, tenant_id, document_type, document_number, name, phone, email, party_type, credit_limit, current_debt)
VALUES (
    '00000000-0000-0000-0000-000000000003',
    '11111111-1111-1111-1111-111111111111',
    'CC',
    '1061808736',
    'Juan Carlos Perez',
    '3124567890',
    'juan.perez@gmail.com',
    'CUSTOMER',
    800000.00,
    351100.00
) ON CONFLICT (tenant_id, document_number) DO NOTHING;

-- 6. Cuentas Contables PUC Minimas
INSERT INTO chart_of_accounts (id, tenant_id, code, name, account_type, nature) VALUES
('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '110505', 'Caja General', 'ACTIVO', 'D'),
('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '130505', 'Clientes Nacionales', 'ACTIVO', 'D'),
('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '143505', 'Mercancias no Fabricadas', 'ACTIVO', 'D'),
('aaaaaaaa-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '220505', 'Proveedores Nacionales', 'PASIVO', 'C'),
('aaaaaaaa-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '240805', 'IVA Generado', 'PASIVO', 'C'),
('aaaaaaaa-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '413505', 'Comercio al por Mayor y Menor', 'INGRESO', 'C'),
('aaaaaaaa-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', '613505', 'Costo de Comercio', 'COSTO', 'D')
ON CONFLICT (tenant_id, code) DO NOTHING;

-- 7. Productos de Prueba
INSERT INTO products (id, tenant_id, sku, barcode, name, unit_of_measure, cost_price, sale_price, tax_rate)
VALUES 
('00000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'CEM-001', '7701234567890', 'Cemento Gris Argos 50kg', 'BULTO', 24500.00, 32000.00, 0.19),
('00000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'CAB-008', '7701234567891', 'Cable Cobre #12 THHN Centelsa', 'METRO', 3100.00, 4200.00, 0.19),
('00000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'TUB-012', '7701234567892', 'Tuberia PVC Sanitaria 3 pulg', 'UNIDAD', 21000.00, 28500.00, 0.19)
ON CONFLICT (tenant_id, sku) DO NOTHING;

-- 8. Saldos Iniciales de Inventario
INSERT INTO stock_quants (tenant_id, product_id, warehouse_id, quantity_on_hand) VALUES
('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000010', 145.000),
('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000010', 850.500),
('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000010', 28.000)
ON CONFLICT (tenant_id, product_id, warehouse_id) DO NOTHING;
