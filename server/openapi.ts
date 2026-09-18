import { Request, Response, Router } from 'express';

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'BOOM OS — Foundation Kernel API',
    version: '1.0.0',
    description: `Official OpenAPI 3.0 specification for the BOOM OS Restaurant Operating System Foundation.

Includes only core foundation endpoints:
* **auth** — Authentication, session state, token lifecycle
* **users** — Staff directory, roles, branch access isolation
* **roles** — Role-based access control (RBAC) and permission assignment
* **permissions** — Granular operational permission catalog
* **branches** — Restaurant locations, timezones, multi-branch hierarchy
* **settings** — Holding-wide system parameters and configuration
* **audit** — Immutable audit ledger of all mutations
* **health** — System and database health status
* **waiter POS** — Personal waiter code authentication and device sessions
* **menu** — Branch menu categories and menu items
* **tables** — Dining areas and tables
* **orders** — Unified Order Core entry and cashier confirmation*`,
    contact: {
      name: 'BOOM OS Architecture Team',
      email: 'dev@boomburger.ru'
    }
  },
  servers: [
    {
      url: '/',
      description: 'Current Environment'
    }
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Provide JWT token obtained from /api/auth/login'
      }
    },
    schemas: {
      HealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'HEALTHY' },
          system_status: { type: 'string', example: 'OPERATIONAL' },
          database_status: { type: 'string', example: 'CONNECTED' },
          system: {
            type: 'object',
            properties: {
              status: { type: 'string', example: 'OPERATIONAL' },
              uptime_seconds: { type: 'number', example: 142 },
              version: { type: 'string', example: '1.0.0' }
            }
          },
          database: {
            type: 'object',
            properties: {
              status: { type: 'string', example: 'CONNECTED' },
              engine: { type: 'string', example: 'PostgreSQL Relational' },
              latest_migration_version: { type: 'number', example: 8 }
            }
          },
          timestamp: { type: 'string', format: 'date-time', example: '2026-09-05T12:00:00.000Z' }
        },
        required: ['system_status', 'database_status', 'timestamp']
      },
      LoginRequest: {
        type: 'object',
        required: ['emailOrPhone', 'password'],
        properties: {
          emailOrPhone: { type: 'string', example: 'owner@example.com' },
          password: { type: 'string', example: 'Password123!' }
        }
      },
      LoginResponse: {
        type: 'object',
        properties: {
          token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsIn...' },
          user: { $ref: '#/components/schemas/UserProfile' }
        }
      },
      UserProfile: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          full_name: { type: 'string' },
          status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'INACTIVE'] },
          branch_id: { type: 'string', nullable: true },
          roles: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                code: { type: 'string' },
                name: { type: 'string' }
              }
            }
          },
          roleCodes: { type: 'array', items: { type: 'string' } },
          permissions: { type: 'array', items: { type: 'string' } },
          allowedBranchIds: { type: 'array', items: { type: 'string' } },
          isSuperUser: { type: 'boolean' }
        }
      },
      UserCreateRequest: {
        type: 'object',
        required: ['email', 'phone', 'full_name', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'manager@boomburger.ru' },
          phone: { type: 'string', example: '+99360000000' },
          full_name: { type: 'string', example: 'Ivan Petrov' },
          password: { type: 'string', minLength: 8, example: 'SecurePassword123!' },
          status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
          branch_id: { type: 'string', nullable: true },
          role_ids: { type: 'array', items: { type: 'string' } },
          allowed_branch_ids: { type: 'array', items: { type: 'string' } }
        }
      },
      UserUpdateRequest: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          phone: { type: 'string' },
          full_name: { type: 'string' },
          password: { type: 'string', minLength: 8 },
          status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'INACTIVE'] },
          branch_id: { type: 'string', nullable: true },
          role_ids: { type: 'array', items: { type: 'string' } },
          allowed_branch_ids: { type: 'array', items: { type: 'string' } }
        }
      },
      Branch: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string', example: 'BOOM Aşgabat Flagship' },
          code: { type: 'string', example: 'BB-ARB-01' },
          address: { type: 'string', example: 'Ashgabat, Turkmenistan' },
          phone: { type: 'string', example: '+993 12 100-20-30' },
          timezone: { type: 'string', example: 'Asia/Ashgabat' },
          currency: { type: 'string', example: 'TMT' },
          status: { type: 'string', enum: ['ACTIVE', 'MAINTENANCE', 'INACTIVE'] },
          created_at: { type: 'string' },
          updated_at: { type: 'string' }
        }
      },
      BranchCreateRequest: {
        type: 'object',
        required: ['name', 'code', 'address', 'phone'],
        properties: {
          name: { type: 'string', example: 'BOOM Aşgabat Flagship' },
          code: { type: 'string', example: 'BB-ARB-01' },
          address: { type: 'string', example: 'Ashgabat, Turkmenistan' },
          phone: { type: 'string', example: '+993 12 100-20-30' },
          timezone: { type: 'string', default: 'Asia/Ashgabat' },
          currency: { type: 'string', default: 'TMT' },
          status: { type: 'string', enum: ['ACTIVE', 'MAINTENANCE', 'INACTIVE'], default: 'ACTIVE' }
        }
      },
      Role: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          code: { type: 'string', example: 'SHIFT_SUPERVISOR' },
          name: { type: 'string', example: 'Shift Supervisor' },
          description: { type: 'string' },
          is_system: { type: 'boolean' },
          status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
          permissions: {
            type: 'array',
            items: { $ref: '#/components/schemas/Permission' }
          }
        }
      },
      RoleCreateRequest: {
        type: 'object',
        required: ['code', 'name'],
        properties: {
          code: { type: 'string', example: 'SENIOR_CASHIER' },
          name: { type: 'string', example: 'Senior Cashier' },
          description: { type: 'string' },
          permission_ids: { type: 'array', items: { type: 'string' } }
        }
      },
      Permission: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          code: { type: 'string', example: 'users.view' },
          name: { type: 'string', example: 'View users list' },
          module: { type: 'string', example: 'users' },
          description: { type: 'string' }
        }
      },
      PermissionCreateRequest: {
        type: 'object',
        required: ['code', 'name', 'module'],
        properties: {
          code: { type: 'string', example: 'reports.export' },
          name: { type: 'string', example: 'Export holding reports' },
          module: { type: 'string', example: 'reports' },
          description: { type: 'string' }
        }
      },
      SystemSetting: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          key: { type: 'string', example: 'holding.name' },
          value: { type: 'string', example: 'BOOMBURGER HOLDINGS' },
          type: { type: 'string', enum: ['string', 'number', 'boolean', 'json'] },
          description: { type: 'string' },
          updated_at: { type: 'string' }
        }
      },
      SettingUpdateRequest: {
        type: 'object',
        required: ['value'],
        properties: {
          value: { type: 'string' }
        }
      },
      AuditLog: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          user_id: { type: 'string', nullable: true },
          user_name: { type: 'string', nullable: true },
          user_email: { type: 'string', nullable: true },
          branch_id: { type: 'string', nullable: true },
          branch_name: { type: 'string', nullable: true },
          action: { type: 'string', example: 'USER_CREATED' },
          entity_type: { type: 'string', example: 'users' },
          entity_id: { type: 'string' },
          old_values: { type: 'object', nullable: true },
          new_values: { type: 'object', nullable: true },
          ip_address: { type: 'string' },
          created_at: { type: 'string' }
        }
      },
      WaiterCodeAuthenticateRequest: {
        type: 'object',
        required: ['code', 'deviceId'],
        properties: {
          code: { type: 'string', pattern: '^\\d{4}$', example: '4821' },
          deviceId: { type: 'string', minLength: 1, maxLength: 128, example: 'tablet-branch-01' }
        }
      },
      WaiterSessionResponse: {
        type: 'object',
        properties: {
          token: { type: 'string' },
          sessionId: { type: 'string' },
          expiresAt: { type: 'string', format: 'date-time' }
        }
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'VALIDATION_ERROR' },
          code: { type: 'string', example: 'VALIDATION_ERROR' },
          message: { type: 'string', example: 'Detailed error explanation' },
          details: { type: 'object', additionalProperties: true }
        }
      }
    }
  },
  paths: {
    '/api/health': {
      get: {
        tags: ['health'],
        summary: 'System and database health check',
        description: 'Returns overall system status, database connectivity status, and current timestamp.',
        responses: {
          200: {
            description: 'System is healthy',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' }
              }
            }
          }
        }
      }
    },
    '/api/auth/login': {
      post: {
        tags: ['auth'],
        summary: 'User login',
        description: 'Authenticates a staff member using email or phone and returns a signed JWT token.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginRequest' }
            }
          }
        },
        responses: {
          200: {
            description: 'Authentication successful',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LoginResponse' }
              }
            }
          },
          401: {
            description: 'Invalid credentials',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/api/auth/me': {
      get: {
        tags: ['auth'],
        summary: 'Current user session profile',
        description: 'Returns authenticated profile, active roles, granted permissions, and allowed branch scopes.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Current user profile',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    user: { $ref: '#/components/schemas/UserProfile' }
                  }
                }
              }
            }
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/api/auth/logout': {
      post: {
        tags: ['auth'],
        summary: 'User logout',
        description: 'Terminates active session and records logout event in audit ledger.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Logged out successfully'
          }
        }
      }
    },
    '/api/users': {
      get: {
        tags: ['users'],
        summary: 'List users',
        description: 'Fetches user accounts with branch isolation and role filtering.',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'branch_id', in: 'query', schema: { type: 'string' } },
          { name: 'role', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } }
        ],
        responses: {
          200: {
            description: 'List of users',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    users: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/UserProfile' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      post: {
        tags: ['users'],
        summary: 'Create user',
        description: 'Registers a new employee with hashed password and role assignments. Requires users.create permission.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UserCreateRequest' }
            }
          }
        },
        responses: {
          201: {
            description: 'User created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    user: { $ref: '#/components/schemas/UserProfile' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/users/{id}': {
      get: {
        tags: ['users'],
        summary: 'Get user by ID',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    user: { $ref: '#/components/schemas/UserProfile' }
                  }
                }
              }
            }
          }
        }
      },
      put: {
        tags: ['users'],
        summary: 'Update user profile, status, roles, or branch access',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UserUpdateRequest' }
            }
          }
        },
        responses: {
          200: {
            description: 'User updated successfully'
          }
        }
      },
      delete: {
        tags: ['users'],
        summary: 'Soft-delete user account',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'User deactivated'
          }
        }
      }
    },
    '/api/roles': {
      get: {
        tags: ['roles'],
        summary: 'List all roles with user count and assigned permissions',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    roles: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Role' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      post: {
        tags: ['roles'],
        summary: 'Create custom role',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RoleCreateRequest' }
            }
          }
        },
        responses: {
          201: {
            description: 'Role created successfully'
          }
        }
      }
    },
    '/api/roles/{id}': {
      get: {
        tags: ['roles'],
        summary: 'Get role details and permission matrix',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    role: { $ref: '#/components/schemas/Role' }
                  }
                }
              }
            }
          }
        }
      },
      put: {
        tags: ['roles'],
        summary: 'Update role and permission bindings',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RoleCreateRequest' }
            }
          }
        },
        responses: {
          200: {
            description: 'Role updated'
          }
        }
      },
      delete: {
        tags: ['roles'],
        summary: 'Delete custom role',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Role deleted'
          }
        }
      }
    },
    '/api/permissions': {
      get: {
        tags: ['permissions'],
        summary: 'List all granular permissions',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    permissions: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Permission' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      post: {
        tags: ['permissions'],
        summary: 'Register new permission in catalog',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PermissionCreateRequest' }
            }
          }
        },
        responses: {
          201: {
            description: 'Permission registered'
          }
        }
      }
    },
    '/api/branches': {
      get: {
        tags: ['branches'],
        summary: 'List restaurant branches in holding',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    branches: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Branch' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      post: {
        tags: ['branches'],
        summary: 'Open new restaurant branch',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/BranchCreateRequest' }
            }
          }
        },
        responses: {
          201: {
            description: 'Branch opened'
          }
        }
      }
    },
    '/api/branches/{id}': {
      get: {
        tags: ['branches'],
        summary: 'Get branch details and assigned personnel',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    branch: { $ref: '#/components/schemas/Branch' }
                  }
                }
              }
            }
          }
        }
      },
      put: {
        tags: ['branches'],
        summary: 'Update branch address, timezone, status',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/BranchCreateRequest' }
            }
          }
        },
        responses: {
          200: {
            description: 'Branch updated'
          }
        }
      },
      delete: {
        tags: ['branches'],
        summary: 'Deactivate branch',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Branch deactivated'
          }
        }
      }
    },
    '/api/settings': {
      get: {
        tags: ['settings'],
        summary: 'List all global system settings',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    settings: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/SystemSetting' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      post: {
        tags: ['settings'],
        summary: 'Create or register a new setting key',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['key', 'value'],
                properties: {
                  key: { type: 'string' },
                  value: { type: 'string' },
                  type: { type: 'string', enum: ['string', 'number', 'boolean', 'json'] },
                  description: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          201: {
            description: 'Setting created'
          }
        }
      }
    },
    '/api/settings/{key}': {
      put: {
        tags: ['settings'],
        summary: 'Update system setting value',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SettingUpdateRequest' }
            }
          }
        },
        responses: {
          200: {
            description: 'Setting updated and recorded in audit ledger'
          }
        }
      }
    },
    '/api/audit': {
      get: {
        tags: ['audit'],
        summary: 'Query immutable audit ledger',
        description: 'Returns historical mutation records with actor, branch, diff changes (old_values, new_values).',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'user_id', in: 'query', schema: { type: 'string' } },
          { name: 'branch_id', in: 'query', schema: { type: 'string' } },
          { name: 'action', in: 'query', schema: { type: 'string' } },
          { name: 'entity_type', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } }
        ],
        responses: {
          200: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    logs: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/AuditLog' }
                    },
                    total: { type: 'integer' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/franchises': {
      get: {
        tags: ['franchises'],
        summary: 'List holding franchises',
        description: 'Returns all franchises with calculated branch_count, employee_count, and active_employee_count.',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] } },
          { name: 'search', in: 'query', schema: { type: 'string' } }
        ],
        responses: {
          200: {
            description: 'List of franchises'
          }
        }
      },
      post: {
        tags: ['franchises'],
        summary: 'Register new franchise holding',
        description: 'Creates a new franchise entity with mandatory contact and legal parameters.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'code', 'legal_name', 'contact_name', 'phone', 'email', 'address'],
                properties: {
                  name: { type: 'string', example: 'Ashgabat Franchise' },
                  code: { type: 'string', example: 'ASH-001' },
                  legal_name: { type: 'string', example: 'BOOMBURGER Ashgabat CJSC' },
                  contact_name: { type: 'string', example: 'Contact Person' },
                  phone: { type: 'string', example: '+993 (12) 45-67-89' },
                  email: { type: 'string', example: 'ashgabat@boomburger.com' },
                  address: { type: 'string', example: 'Ashgabat, Bitarap Turkmenistan Ave, 108' },
                  status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' }
                }
              }
            }
          }
        },
        responses: {
          201: { description: 'Franchise created successfully' }
        }
      }
    },
    '/api/franchises/{id}': {
      get: {
        tags: ['franchises'],
        summary: 'Get franchise details and metrics',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Franchise details' } }
      },
      put: {
        tags: ['franchises'],
        summary: 'Update franchise parameters',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  code: { type: 'string' },
                  legal_name: { type: 'string' },
                  contact_name: { type: 'string' },
                  phone: { type: 'string' },
                  email: { type: 'string' },
                  address: { type: 'string' },
                  status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'Franchise updated' } }
      }
    },
    '/api/franchises/{id}/branches': {
      get: {
        tags: ['franchises'],
        summary: 'Get all branches belonging to franchise',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'List of branches in this franchise' } }
      }
    },
    '/api/franchises/{id}/branches/{branchId}': {
      post: {
        tags: ['franchises'],
        summary: 'Assign branch to franchise',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'branchId', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: { 200: { description: 'Branch assigned to franchise' } }
      },
      delete: {
        tags: ['franchises'],
        summary: 'Unlink branch from franchise without deleting branch',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'branchId', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: { 200: { description: 'Branch unlinked' } }
      }
    },
    '/api/franchises/{id}/employees': {
      get: {
        tags: ['franchises'],
        summary: 'Get employees belonging to franchise',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'List of employees associated with franchise branches' } }
      }
    },
    '/api/users/{id}/branch-access': {
      get: {
        tags: ['users'],
        summary: 'Get user primary branch and allowed branches',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'User branch access matrix' } }
      },
      put: {
        tags: ['users'],
        summary: 'Update user branch access and primary branch',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  primary_branch_id: { type: 'string', nullable: true },
                  allowed_branch_ids: { type: 'array', items: { type: 'string' } },
                  has_all_access: { type: 'boolean' }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'Branch access updated' } }
      }
    },
    '/api/rbac/options': {
      get: {
        tags: ['rbac'],
        summary: 'Get simulation options for RBAC console',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'Lists of users, roles, franchises, branches, permissions' } }
      }
    },
    '/api/rbac/test': {
      post: {
        tags: ['rbac'],
        summary: 'Perform read-only RBAC authorization simulation',
        description: 'Simulates authorization for User + Role + Franchise + Branch + Permission without modifying any state in the system.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['user_id'],
                properties: {
                  user_id: { type: 'string' },
                  role_id: { type: 'string' },
                  franchise_id: { type: 'string' },
                  branch_id: { type: 'string' },
                  permission: { type: 'string' },
                  test_matrix: { type: 'boolean', default: true }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Simulation outcome: allowed, status, reason, matrix_results'
          }
        }
      }
    },
    '/api/waiters/authenticate-code': {
      post: {
        tags: ['waiter-pos'],
        summary: 'Authenticate waiter code and create POS session',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/WaiterCodeAuthenticateRequest' } } } },
        responses: { 200: { description: 'Waiter session created' }, 400: { description: 'Invalid request' }, 401: { description: 'Invalid code' }, 429: { description: 'Too many attempts' } }
      }
    },
    '/api/waiters/session': {
      get: { tags: ['waiter-pos'], summary: 'Validate current waiter POS session', responses: { 200: { description: 'Active session' }, 401: { description: 'Invalid or expired session' } } }
    },
    '/api/waiters/logout': {
      post: { tags: ['waiter-pos'], summary: 'Revoke current waiter POS session', responses: { 200: { description: 'Session revoked' } } }
    },
    '/api/waiters': {
      get: { tags: ['waiter-pos'], summary: 'List waiters and POS code status', security: [{ BearerAuth: [] }], responses: { 200: { description: 'Waiter list' }, 403: { description: 'Manager only' } } }
    },
    '/api/waiters/{id}/code': {
      post: { tags: ['waiter-pos'], summary: 'Create or replace waiter POS code', security: [{ BearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Code replaced' }, 201: { description: 'Code created' }, 403: { description: 'Manager only' } } },
      delete: { tags: ['waiter-pos'], summary: 'Revoke waiter POS code', security: [{ BearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Code revoked' }, 403: { description: 'Manager only' } } }
    },
    '/api/menu/pos': {
      get: { tags: ['menu'], summary: 'Get active branch menu for a waiter POS session', parameters: [{ name: 'branch_id', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Active menu' }, 401: { description: 'Invalid waiter session' } } }
    },
    '/api/menu': {
      get: { tags: ['menu'], summary: 'Get active menu for an authorized branch', security: [{ BearerAuth: [] }], parameters: [{ name: 'branch_id', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Menu' } } },
      post: { tags: ['menu'], summary: 'Create menu category/item', security: [{ BearerAuth: [] }], responses: { 201: { description: 'Created' } } }
    },
    '/api/tables/pos': {
      get: { tags: ['tables'], summary: 'Get dining areas and tables for waiter POS session', responses: { 200: { description: 'Dining layout' }, 401: { description: 'Invalid waiter session' } } }
    },
    '/api/tables': {
      get: { tags: ['tables'], summary: 'Get dining areas and tables for an authorized branch', security: [{ BearerAuth: [] }], responses: { 200: { description: 'Dining layout' } } },
      post: { tags: ['tables'], summary: 'Create a dining table', security: [{ BearerAuth: [] }], responses: { 201: { description: 'Table created' } } }
    },
    '/api/orders': {
      post: { tags: ['orders'], summary: 'Create waiter POS order through unified Order Core', description: 'Waiter identity and branch are taken from the Waiter POS session. Client-supplied waiter_id is ignored.', parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string' } }], responses: { 201: { description: 'Order created in PENDING_CONFIRMATION' }, 200: { description: 'Idempotent replay' }, 401: { description: 'Invalid waiter session' } } },
      get: { tags: ['orders'], summary: 'List orders in an authorized branch', security: [{ BearerAuth: [] }], responses: { 200: { description: 'Orders' } } }
    },
    '/api/orders/{id}/confirm': {
      post: { tags: ['orders'], summary: 'Cashier/manager confirms waiter order', security: [{ BearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Order confirmed' }, 409: { description: 'Invalid state' } } }
    },
    '/api/orders/{id}/items/{itemId}/removal-request': { post: { tags: ['orders'], summary: 'Waiter requests manager approval to remove an order item', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 201: { description: 'Removal request created' }, 409: { description: 'Invalid state' } } } },
    '/api/orders/removal-requests': { get: { tags: ['orders'], summary: 'List pending order item removal approvals', security: [{ BearerAuth: [] }], responses: { 200: { description: 'Removal approval requests' } } } },
    '/api/orders/removal-requests/{approvalId}/approve': { post: { tags: ['orders'], summary: 'Approve an order item removal request', security: [{ BearerAuth: [] }], parameters: [{ name: 'approvalId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Removal approved' }, 403: { description: 'Forbidden' }, 409: { description: 'Invalid state' } } } },
    '/api/orders/removal-requests/{approvalId}/reject': { post: { tags: ['orders'], summary: 'Reject an order item removal request', security: [{ BearerAuth: [] }], parameters: [{ name: 'approvalId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Removal rejected' }, 403: { description: 'Forbidden' }, 409: { description: 'Invalid state' } } } },
    '/api/menu/items/{itemId}/modifiers': { get: { tags: ['menu'], summary: 'List active modifier groups and modifiers for a menu item', security: [{ BearerAuth: [] }], parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Modifier groups' }, 403: { description: 'Forbidden' } } } },
    '/api/menu/items/{itemId}/modifier-groups': { post: { tags: ['menu'], summary: 'Create a modifier group for a menu item', security: [{ BearerAuth: [] }], parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 201: { description: 'Modifier group created' }, 400: { description: 'Validation error' } } } },
    '/api/menu/modifier-groups/{groupId}/modifiers': { post: { tags: ['menu'], summary: 'Create a menu modifier', security: [{ BearerAuth: [] }], parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 201: { description: 'Modifier created' }, 400: { description: 'Validation error' } } } },
    '/api/payments': { get: { tags: ['payments'], summary: 'List payments in an authorized branch', security: [{ BearerAuth: [] }], responses: { 200: { description: 'Payments' } } }, post: { tags: ['payments'], summary: 'Pay a confirmed order', security: [{ BearerAuth: [] }], parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } }], responses: { 201: { description: 'Payment created' }, 409: { description: 'Order not ready, shift missing, or invalid amount' } } } },
    '/api/payments/{id}/refund': { post: { tags: ['payments'], summary: 'Refund a paid order payment and restore inventory', security: [{ BearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Payment refunded' }, 409: { description: 'Payment not refundable' } } } },
    '/api/cash-shifts': { get: { tags: ['finance'], summary: 'List cash shifts', security: [{ BearerAuth: [] }], responses: { 200: { description: 'Cash shifts' } } }, post: { tags: ['finance'], summary: 'Open a cash shift', security: [{ BearerAuth: [] }], responses: { 201: { description: 'Shift opened' }, 409: { description: 'Another shift is already open' } } } },
    '/api/cash-shifts/{id}/z-report': { post: { tags: ['finance'], summary: 'Close cash shift with Z report', security: [{ BearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Z report and closed shift' } } } },
    '/api/kds': { get: { tags: ['kds'], summary: 'List kitchen tickets', security: [{ BearerAuth: [] }], responses: { 200: { description: 'KDS tickets' } } } },
    '/api/kds/{id}/status': { post: { tags: ['kds'], summary: 'Advance a kitchen ticket status', security: [{ BearerAuth: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'KDS ticket updated' }, 409: { description: 'Invalid transition' } } } },
  }
};

export const docsRouter = Router();

// 1. JSON spec endpoint
docsRouter.get('/openapi.json', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(openApiSpec);
});

// 2. Interactive Swagger UI HTML page
docsRouter.get('/', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>BOOM OS API Documentation — Swagger UI</title>
  <link rel="stylesheet" type="text/css" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui.css" />
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23f59e0b'><polygon points='13 2 3 14 12 14 11 22 21 10 12 10 13 2'></polygon></svg>" />
  <style>
    body {
      margin: 0;
      padding: 0;
      background: #090d16;
      color: #f1f5f9;
      font-family: ui-sans-serif, system-ui, sans-serif;
    }
    .top-header {
      background: #0f172a;
      border-bottom: 1px solid #1e293b;
      padding: 14px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .top-header .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 800;
      font-size: 16px;
      color: #fff;
      letter-spacing: -0.02em;
    }
    .top-header .badge {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-family: monospace;
      font-weight: 700;
    }
    .top-header a {
      color: #94a3b8;
      text-decoration: none;
      font-size: 13px;
      padding: 6px 12px;
      border-radius: 6px;
      background: #1e293b;
      transition: all 0.2s;
    }
    .top-header a:hover {
      color: #fff;
      background: #334155;
    }
    /* Dark theme overrides for Swagger UI */
    .swagger-ui {
      filter: invert(88%) hue-rotate(180deg);
      max-width: 1280px;
      margin: 0 auto;
      padding: 20px;
    }
    .swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div class="top-header">
    <div class="brand">
      <span style="display:inline-flex; width:28px; height:28px; background:#f59e0b; color:#0f172a; border-radius:8px; align-items:center; justify-content:center; font-weight:900;">B</span>
      <span>BOOM OS — API Documentation</span>
      <span class="badge">OpenAPI 3.0.3</span>
    </div>
    <div style="display:flex; gap:10px; align-items:center;">
      <a href="/api/docs/openapi.json" target="_blank">View OpenAPI JSON</a>
      <a href="/" target="_self">← Return to BOOM HQ</a>
    </div>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui-bundle.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/api/docs/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`);
});
