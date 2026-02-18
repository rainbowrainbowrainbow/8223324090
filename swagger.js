/**
 * swagger.js — OpenAPI 3.0 specification for Event Maestro API
 *
 * This file contains the complete API spec as a plain JS object.
 * No swagger-jsdoc dependency needed — the spec is defined manually.
 *
 * Integration: In server.js, add swagger-ui-express and mount at /api-docs:
 *   const swaggerUi = require('swagger-ui-express');
 *   const { swaggerSpec } = require('./swagger');
 *   app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
 *   app.get('/api-docs.json', (req, res) => res.json(swaggerSpec));
 */

const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Event Maestro — Booking API',
    version: '11.0.0',
    description: 'REST API для системи бронювання дитячого розважального парку. Усі дати зберігаються в UTC, відображаються у Europe/Kyiv (UTC+2/+3). Валюта: UAH (₴). Номери бронювань: BK-YYYY-NNNN.'
  },
  servers: [
    { url: '/api', description: 'API base path' }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token obtained from POST /auth/login. Expires in 24h.'
      }
    },
    schemas: {
      // --- Auth ---
      LoginRequest: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', example: 'admin' },
          password: { type: 'string', example: 'admin123' }
        }
      },
      LoginResponse: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'JWT token' },
          user: {
            type: 'object',
            properties: {
              username: { type: 'string' },
              role: { type: 'string', enum: ['admin', 'manager', 'user', 'viewer'] },
              name: { type: 'string' }
            }
          }
        }
      },
      UserInfo: {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              username: { type: 'string' },
              role: { type: 'string' },
              name: { type: 'string' }
            }
          }
        }
      },

      // --- Booking ---
      Booking: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'BK-2026-0001', description: 'Booking number (BK-YYYY-NNNN)' },
          date: { type: 'string', format: 'date', example: '2026-02-14' },
          time: { type: 'string', example: '12:00' },
          lineId: { type: 'string', description: 'Animator line ID' },
          programId: { type: 'string' },
          programCode: { type: 'string', example: 'ШН' },
          label: { type: 'string', example: 'ШН(60)' },
          programName: { type: 'string', example: 'Шпигунський Квест' },
          category: { type: 'string', enum: ['quest', 'animation', 'show', 'photo', 'masterclass', 'pinata', 'custom'] },
          duration: { type: 'integer', example: 60, description: 'Duration in minutes' },
          price: { type: 'number', example: 3500, description: 'Price in UAH' },
          hosts: { type: 'integer', example: 1 },
          secondAnimator: { type: 'string', nullable: true },
          pinataFiller: { type: 'string', nullable: true },
          costume: { type: 'string', nullable: true },
          room: { type: 'string', example: 'Кімната 1' },
          notes: { type: 'string', nullable: true },
          createdBy: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['confirmed', 'preliminary', 'cancelled'], default: 'confirmed' },
          kidsCount: { type: 'integer', nullable: true },
          groupName: { type: 'string', nullable: true },
          extraData: { type: 'object', nullable: true, description: 'Additional data (e.g. tshirt_sizes)' },
          linkedTo: { type: 'string', nullable: true, description: 'Parent booking ID for linked bookings' },
          updatedAt: { type: 'string', format: 'date-time', nullable: true }
        }
      },
      BookingCreateRequest: {
        type: 'object',
        required: ['date', 'time', 'lineId'],
        properties: {
          date: { type: 'string', format: 'date' },
          time: { type: 'string', example: '12:00' },
          lineId: { type: 'string' },
          programId: { type: 'string' },
          programCode: { type: 'string' },
          label: { type: 'string' },
          programName: { type: 'string' },
          category: { type: 'string' },
          duration: { type: 'integer' },
          price: { type: 'number' },
          hosts: { type: 'integer' },
          secondAnimator: { type: 'string', nullable: true },
          pinataFiller: { type: 'string', nullable: true },
          costume: { type: 'string', nullable: true },
          room: { type: 'string' },
          notes: { type: 'string', nullable: true },
          createdBy: { type: 'string' },
          status: { type: 'string', enum: ['confirmed', 'preliminary'], default: 'confirmed' },
          kidsCount: { type: 'integer', nullable: true },
          groupName: { type: 'string', nullable: true },
          extraData: { type: 'object', nullable: true }
        }
      },
      BookingFullCreateRequest: {
        type: 'object',
        required: ['main'],
        properties: {
          main: { $ref: '#/components/schemas/BookingCreateRequest' },
          linked: {
            type: 'array',
            items: { $ref: '#/components/schemas/BookingCreateRequest' },
            description: 'Linked bookings (second animator, extra host)'
          }
        }
      },

      // --- Line ---
      Line: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'line1' },
          name: { type: 'string', example: 'Женя' },
          color: { type: 'string', example: '#4CAF50' },
          fromSheet: { type: 'boolean', default: false }
        }
      },

      // --- History ---
      HistoryItem: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          action: { type: 'string', example: 'create' },
          user: { type: 'string' },
          data: { type: 'object', description: 'Action-specific JSON data' },
          timestamp: { type: 'string', format: 'date-time' }
        }
      },
      HistoryResponse: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/HistoryItem' } },
          total: { type: 'integer' },
          limit: { type: 'integer' },
          offset: { type: 'integer' }
        }
      },

      // --- Product ---
      Product: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          code: { type: 'string', example: 'ШН' },
          label: { type: 'string', example: 'ШН(60)' },
          name: { type: 'string', example: 'Шпигунський Квест' },
          icon: { type: 'string', example: '🕵️' },
          category: { type: 'string' },
          duration: { type: 'integer' },
          price: { type: 'number' },
          hosts: { type: 'integer' },
          ageRange: { type: 'string', nullable: true },
          kidsCapacity: { type: 'string', nullable: true },
          description: { type: 'string', nullable: true },
          isPerChild: { type: 'boolean' },
          hasFiller: { type: 'boolean' },
          isCustom: { type: 'boolean' },
          isActive: { type: 'boolean' },
          sortOrder: { type: 'integer' },
          updatedAt: { type: 'string', format: 'date-time', nullable: true },
          updatedBy: { type: 'string', nullable: true }
        }
      },
      ProductCreateRequest: {
        type: 'object',
        required: ['code', 'label', 'name', 'category', 'duration'],
        properties: {
          code: { type: 'string', maxLength: 20 },
          label: { type: 'string', maxLength: 100 },
          name: { type: 'string', maxLength: 200 },
          icon: { type: 'string' },
          category: { type: 'string' },
          duration: { type: 'integer', minimum: 0 },
          price: { type: 'number', minimum: 0, default: 0 },
          hosts: { type: 'integer', minimum: 0, default: 1 },
          ageRange: { type: 'string', nullable: true },
          kidsCapacity: { type: 'string', nullable: true },
          description: { type: 'string', nullable: true },
          isPerChild: { type: 'boolean', default: false },
          hasFiller: { type: 'boolean', default: false },
          isCustom: { type: 'boolean', default: false },
          isActive: { type: 'boolean', default: true },
          sortOrder: { type: 'integer', default: 0 }
        }
      },

      // --- Afisha ---
      AfishaEvent: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          date: { type: 'string', format: 'date' },
          time: { type: 'string', example: '14:00' },
          title: { type: 'string' },
          duration: { type: 'integer', example: 60 },
          type: { type: 'string', enum: ['event', 'birthday', 'regular'] },
          description: { type: 'string', nullable: true },
          template_id: { type: 'integer', nullable: true },
          original_time: { type: 'string', nullable: true },
          line_id: { type: 'string', nullable: true, description: 'Assigned animator line (after distribution)' }
        }
      },
      AfishaCreateRequest: {
        type: 'object',
        required: ['date', 'time', 'title'],
        properties: {
          date: { type: 'string', format: 'date' },
          time: { type: 'string' },
          title: { type: 'string' },
          duration: { type: 'integer', default: 60 },
          type: { type: 'string', enum: ['event', 'birthday', 'regular'], default: 'event' },
          description: { type: 'string', nullable: true }
        }
      },
      AfishaTemplate: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          title: { type: 'string' },
          time: { type: 'string' },
          duration: { type: 'integer' },
          type: { type: 'string', enum: ['event', 'birthday', 'regular'] },
          description: { type: 'string', nullable: true },
          recurrence_pattern: { type: 'string', enum: ['daily', 'weekdays', 'weekends', 'weekly', 'custom'] },
          recurrence_days: { type: 'string', nullable: true, description: 'Comma-separated day numbers (1=Mon..7=Sun) for custom pattern' },
          date_from: { type: 'string', format: 'date', nullable: true },
          date_to: { type: 'string', format: 'date', nullable: true },
          is_active: { type: 'boolean' }
        }
      },
      AfishaTemplateCreateRequest: {
        type: 'object',
        required: ['title', 'time'],
        properties: {
          title: { type: 'string' },
          time: { type: 'string' },
          duration: { type: 'integer', default: 60 },
          type: { type: 'string', default: 'event' },
          description: { type: 'string', nullable: true },
          recurrence_pattern: { type: 'string', default: 'weekly' },
          recurrence_days: { type: 'string', nullable: true },
          date_from: { type: 'string', format: 'date', nullable: true },
          date_to: { type: 'string', format: 'date', nullable: true }
        }
      },

      // --- Task ---
      Task: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          title: { type: 'string' },
          description: { type: 'string', nullable: true },
          date: { type: 'string', format: 'date', nullable: true },
          status: { type: 'string', enum: ['todo', 'in_progress', 'done'] },
          priority: { type: 'string', enum: ['low', 'normal', 'high'] },
          assigned_to: { type: 'string', nullable: true },
          created_by: { type: 'string' },
          type: { type: 'string', enum: ['manual', 'recurring', 'afisha', 'auto_complete'] },
          template_id: { type: 'integer', nullable: true },
          afisha_id: { type: 'integer', nullable: true },
          category: { type: 'string', enum: ['event', 'purchase', 'admin', 'trampoline', 'personal', 'improvement'] },
          completed_at: { type: 'string', format: 'date-time', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time', nullable: true }
        }
      },
      TaskCreateRequest: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string' },
          description: { type: 'string', nullable: true },
          date: { type: 'string', format: 'date', nullable: true },
          priority: { type: 'string', enum: ['low', 'normal', 'high'], default: 'normal' },
          assigned_to: { type: 'string', nullable: true },
          type: { type: 'string', default: 'manual' },
          template_id: { type: 'integer', nullable: true },
          afisha_id: { type: 'integer', nullable: true },
          category: { type: 'string', default: 'admin' }
        }
      },

      // --- Task Template ---
      TaskTemplate: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          title: { type: 'string' },
          description: { type: 'string', nullable: true },
          priority: { type: 'string', enum: ['low', 'normal', 'high'] },
          category: { type: 'string' },
          assignedTo: { type: 'string', nullable: true },
          recurrencePattern: { type: 'string', enum: ['daily', 'weekly', 'weekdays', 'custom'] },
          recurrenceDays: { type: 'string', nullable: true },
          isActive: { type: 'boolean' },
          createdBy: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' }
        }
      },
      TaskTemplateCreateRequest: {
        type: 'object',
        required: ['title', 'recurrencePattern'],
        properties: {
          title: { type: 'string' },
          description: { type: 'string', nullable: true },
          priority: { type: 'string', default: 'normal' },
          category: { type: 'string', default: 'admin' },
          assignedTo: { type: 'string', nullable: true },
          recurrencePattern: { type: 'string', enum: ['daily', 'weekly', 'weekdays', 'custom'] },
          recurrenceDays: { type: 'string', nullable: true }
        }
      },

      // --- Staff ---
      StaffMember: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          department: { type: 'string', enum: ['animators', 'admin', 'cafe', 'tech', 'cleaning', 'security'] },
          position: { type: 'string' },
          phone: { type: 'string', nullable: true },
          hire_date: { type: 'string', format: 'date', nullable: true },
          is_active: { type: 'boolean' },
          color: { type: 'string', nullable: true },
          telegram_username: { type: 'string', nullable: true }
        }
      },
      StaffCreateRequest: {
        type: 'object',
        required: ['name', 'department', 'position'],
        properties: {
          name: { type: 'string' },
          department: { type: 'string' },
          position: { type: 'string' },
          phone: { type: 'string', nullable: true },
          hireDate: { type: 'string', format: 'date', nullable: true },
          color: { type: 'string', nullable: true },
          telegramUsername: { type: 'string', nullable: true }
        }
      },
      StaffSchedule: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          staff_id: { type: 'integer' },
          date: { type: 'string', format: 'date' },
          shift_start: { type: 'string', nullable: true, example: '09:00' },
          shift_end: { type: 'string', nullable: true, example: '18:00' },
          status: { type: 'string', enum: ['working', 'remote', 'dayoff', 'vacation', 'sick'] },
          note: { type: 'string', nullable: true }
        }
      },
      ScheduleUpsertRequest: {
        type: 'object',
        required: ['staffId', 'date'],
        properties: {
          staffId: { type: 'integer' },
          date: { type: 'string', format: 'date' },
          shiftStart: { type: 'string', nullable: true, example: '10:00' },
          shiftEnd: { type: 'string', nullable: true, example: '20:00' },
          status: { type: 'string', enum: ['working', 'remote', 'dayoff', 'vacation', 'sick'], default: 'working' },
          note: { type: 'string', nullable: true }
        }
      },

      // --- Certificate ---
      Certificate: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          certCode: { type: 'string', example: 'PZP-AB12CD' },
          displayMode: { type: 'string', enum: ['fio', 'number'] },
          displayValue: { type: 'string' },
          typeText: { type: 'string', example: 'на одноразовий вхід' },
          validUntil: { type: 'string', format: 'date', nullable: true },
          issuedAt: { type: 'string', format: 'date-time' },
          issuedByUserId: { type: 'integer', nullable: true },
          issuedByName: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['active', 'used', 'expired', 'revoked', 'blocked'] },
          usedAt: { type: 'string', format: 'date-time', nullable: true },
          invalidatedAt: { type: 'string', format: 'date-time', nullable: true },
          invalidReason: { type: 'string', nullable: true },
          notes: { type: 'string', nullable: true },
          season: { type: 'string', enum: ['winter', 'spring', 'summer', 'autumn'], nullable: true },
          telegramAlertSent: { type: 'boolean' }
        }
      },
      CertificateCreateRequest: {
        type: 'object',
        properties: {
          displayMode: { type: 'string', enum: ['fio', 'number'], default: 'fio' },
          displayValue: { type: 'string' },
          typeText: { type: 'string', default: 'на одноразовий вхід' },
          validUntil: { type: 'string', format: 'date', nullable: true },
          notes: { type: 'string', nullable: true },
          season: { type: 'string', nullable: true }
        }
      },
      CertificateBatchRequest: {
        type: 'object',
        required: ['quantity'],
        properties: {
          quantity: { type: 'integer', enum: [5, 10, 15, 20] },
          typeText: { type: 'string', default: 'на одноразовий вхід' },
          validUntil: { type: 'string', format: 'date', nullable: true },
          season: { type: 'string', nullable: true }
        }
      },

      // --- Setting ---
      Setting: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string' }
        }
      },

      // --- Automation Rule ---
      AutomationRule: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          trigger_type: { type: 'string', enum: ['booking_create', 'booking_confirm'] },
          trigger_condition: { type: 'object', description: 'JSON condition (e.g. { product_ids: [...] })' },
          actions: { type: 'array', items: { type: 'object' }, description: 'Array of action objects' },
          days_before: { type: 'integer', default: 0 },
          is_active: { type: 'boolean' },
          created_at: { type: 'string', format: 'date-time' }
        }
      },
      AutomationRuleCreateRequest: {
        type: 'object',
        required: ['name', 'trigger_condition', 'actions'],
        properties: {
          name: { type: 'string' },
          trigger_type: { type: 'string', default: 'booking_create' },
          trigger_condition: { type: 'object' },
          actions: { type: 'array', items: { type: 'object' } },
          days_before: { type: 'integer', default: 0 }
        }
      },

      // --- Points (v10.0) ---
      UserPoints: {
        type: 'object',
        properties: {
          username: { type: 'string' },
          permanentPoints: { type: 'integer', description: 'Cumulative permanent points' },
          monthlyPoints: { type: 'integer', description: 'Monthly points (reset 1st of month)' },
          month: { type: 'string', example: '2026-02' }
        }
      },
      PointTransaction: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          username: { type: 'string' },
          points: { type: 'integer' },
          type: { type: 'string', enum: ['permanent', 'monthly'] },
          reason: { type: 'string', example: 'ON_TIME' },
          taskId: { type: 'integer', nullable: true },
          taskTitle: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' }
        }
      },

      // --- Kleshnya (v11.0) ---
      KleshnyaGreeting: {
        type: 'object',
        properties: {
          greeting: { type: 'string', description: 'Personalized daily greeting text' },
          cached: { type: 'boolean', description: 'Whether response was from cache' },
          source: { type: 'string', enum: ['template', 'cache'] }
        }
      },
      KleshnyaChatMessage: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          username: { type: 'string' },
          role: { type: 'string', enum: ['user', 'assistant'] },
          message: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' }
        }
      },
      KleshnyaChatResponse: {
        type: 'object',
        properties: {
          role: { type: 'string', example: 'assistant' },
          message: { type: 'string' },
          id: { type: 'integer' },
          created_at: { type: 'string', format: 'date-time' },
          source: { type: 'string', example: 'template' }
        }
      },

      // --- Recurring Bookings (v9.0) ---
      RecurringTemplate: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          pattern: { type: 'string', enum: ['weekly', 'biweekly', 'monthly', 'custom', 'weekdays', 'weekends'] },
          daysOfWeek: { type: 'array', items: { type: 'integer' }, nullable: true },
          intervalWeeks: { type: 'integer', default: 1 },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date', nullable: true },
          timeStart: { type: 'string', example: '12:00' },
          timeEnd: { type: 'string', example: '13:00' },
          productId: { type: 'string' },
          productName: { type: 'string' },
          category: { type: 'string' },
          duration: { type: 'integer' },
          price: { type: 'number', nullable: true },
          room: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['confirmed', 'preliminary'] },
          isActive: { type: 'boolean' },
          instanceCount: { type: 'integer' },
          skipCount: { type: 'integer' },
          nextDate: { type: 'string', format: 'date', nullable: true }
        }
      },
      RecurringTemplateCreate: {
        type: 'object',
        required: ['pattern', 'startDate', 'timeStart', 'productId'],
        properties: {
          pattern: { type: 'string', enum: ['weekly', 'biweekly', 'monthly', 'custom', 'weekdays', 'weekends'] },
          daysOfWeek: { type: 'array', items: { type: 'integer' } },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          timeStart: { type: 'string', example: '12:00' },
          productId: { type: 'string' },
          productCode: { type: 'string' },
          productLabel: { type: 'string' },
          productName: { type: 'string' },
          category: { type: 'string' },
          duration: { type: 'integer', default: 60 },
          price: { type: 'number' },
          hosts: { type: 'integer', default: 1 },
          room: { type: 'string' },
          status: { type: 'string', enum: ['confirmed', 'preliminary'], default: 'preliminary' },
          notes: { type: 'string' },
          extraData: { type: 'object' }
        }
      },
      RecurringSkip: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          templateId: { type: 'integer' },
          date: { type: 'string', format: 'date' },
          reason: { type: 'string' },
          note: { type: 'string', nullable: true }
        }
      },

      // --- Stats (v10.4) ---
      StatsRevenue: {
        type: 'object',
        properties: {
          period: { type: 'object', properties: { from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' } } },
          totals: {
            type: 'object',
            properties: {
              revenue: { type: 'integer' },
              confirmedRevenue: { type: 'integer' },
              count: { type: 'integer' },
              average: { type: 'integer' },
              confirmedCount: { type: 'integer' },
              preliminaryCount: { type: 'integer' }
            }
          },
          comparison: {
            type: 'object',
            properties: {
              prevRevenue: { type: 'integer' },
              revenueGrowth: { type: 'number', description: 'Growth % vs previous period' }
            }
          },
          daily: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, revenue: { type: 'integer' }, count: { type: 'integer' } } } }
        }
      },

      // --- Profile (v10.3–v11.0) ---
      UserProfile: {
        type: 'object',
        properties: {
          user: { type: 'object', properties: { username: { type: 'string' }, role: { type: 'string' }, name: { type: 'string' } } },
          points: { $ref: '#/components/schemas/UserPoints' },
          bookings: { type: 'object', description: 'Booking statistics for user' },
          tasks: { type: 'object', description: 'Task statistics for user' },
          achievements: { type: 'array', items: { type: 'object' } },
          streak: { type: 'object', properties: { currentStreak: { type: 'integer' }, longestStreak: { type: 'integer' } } }
        }
      },

      // --- Common ---
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string' }
        }
      },
      SuccessResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true }
        }
      }
    }
  },
  security: [{ bearerAuth: [] }],

  paths: {
    // ==========================================
    // AUTH
    // ==========================================
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'User login',
        description: 'Authenticate with username/password, receive JWT token (24h expiry)',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } }
        },
        responses: {
          200: { description: 'Login successful', content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginResponse' } } } },
          400: { description: 'Missing username or password' },
          401: { description: 'Invalid credentials' },
          500: { description: 'Server error' }
        }
      }
    },
    '/auth/verify': {
      get: {
        tags: ['Auth'],
        summary: 'Verify token / get current user',
        responses: {
          200: { description: 'Token valid', content: { 'application/json': { schema: { $ref: '#/components/schemas/UserInfo' } } } },
          401: { description: 'Invalid or expired token' }
        }
      }
    },
    '/auth/profile': {
      get: {
        tags: ['Auth'],
        summary: 'Get user profile with full analytics',
        description: 'Consolidated profile: user info, points, tasks, bookings, achievements, streaks. 23 parallel SQL queries via Promise.allSettled.',
        responses: {
          200: { description: 'User profile', content: { 'application/json': { schema: { $ref: '#/components/schemas/UserProfile' } } } },
          401: { description: 'Not authenticated' }
        }
      }
    },
    '/auth/achievements': {
      get: {
        tags: ['Auth'],
        summary: 'Get available achievements list',
        description: 'Returns all 12 achievements with their unlock criteria.',
        responses: {
          200: { description: 'Achievements list', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } }
        }
      }
    },
    '/auth/log-action': {
      post: {
        tags: ['Auth'],
        summary: 'Log user UI action',
        description: 'Track user clicks/actions for analytics (user_action_log table).',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['action'], properties: { action: { type: 'string', example: 'click_booking' }, target: { type: 'string' }, meta: { type: 'object' } } } } }
        },
        responses: {
          200: { description: 'Action logged', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
        }
      }
    },
    '/auth/action-log': {
      get: {
        tags: ['Auth'],
        summary: 'Get user action audit trail (admin)',
        parameters: [
          { name: 'username', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } }
        ],
        responses: {
          200: { description: 'Action log entries' }
        }
      }
    },
    '/auth/tasks/{id}/quick-status': {
      patch: {
        tags: ['Auth'],
        summary: 'Quick task status toggle from profile',
        description: 'Inline task actions (start/done) from personal cabinet.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['in_progress', 'done'] } } } } }
        },
        responses: {
          200: { description: 'Task status updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
          404: { description: 'Task not found' }
        }
      }
    },
    '/auth/password': {
      put: {
        tags: ['Auth'],
        summary: 'Change password',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['currentPassword', 'newPassword'], properties: { currentPassword: { type: 'string' }, newPassword: { type: 'string', minLength: 6 } } } } }
        },
        responses: {
          200: { description: 'Password changed', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
          400: { description: 'Invalid current password or new password too short' }
        }
      }
    },

    // ==========================================
    // BOOKINGS
    // ==========================================
    '/bookings/{date}': {
      get: {
        tags: ['Bookings'],
        summary: 'Get all bookings for a date',
        parameters: [
          { name: 'date', in: 'path', required: true, schema: { type: 'string', format: 'date' }, example: '2026-02-14' }
        ],
        responses: {
          200: { description: 'Array of bookings', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Booking' } } } } },
          400: { description: 'Invalid date format' }
        }
      }
    },
    '/bookings': {
      post: {
        tags: ['Bookings'],
        summary: 'Create a single booking',
        description: 'Creates a booking with server-side conflict/duplicate/room checks. Generates booking number if not provided. Sends Telegram notification after commit.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/BookingCreateRequest' } } }
        },
        responses: {
          200: { description: 'Booking created', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, booking: { $ref: '#/components/schemas/Booking' } } } } } },
          400: { description: 'Missing required fields or invalid format' },
          409: { description: 'Time conflict, duplicate program, or room conflict' },
          500: { description: 'Server error' }
        }
      }
    },
    '/bookings/full': {
      post: {
        tags: ['Bookings'],
        summary: 'Create booking with linked bookings (transactional)',
        description: 'Creates a main booking and linked bookings (second animator, extra host) in a single transaction. All-or-nothing.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/BookingFullCreateRequest' } } }
        },
        responses: {
          200: { description: 'All bookings created', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, mainBooking: { $ref: '#/components/schemas/Booking' }, linkedBookings: { type: 'array', items: { $ref: '#/components/schemas/Booking' } } } } } } },
          400: { description: 'Missing required fields' },
          409: { description: 'Conflict detected' },
          500: { description: 'Server error' }
        }
      }
    },
    '/bookings/{id}': {
      put: {
        tags: ['Bookings'],
        summary: 'Update booking by ID',
        description: 'Full update with optimistic locking (updatedAt). Syncs linked bookings when secondAnimator changes.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'BK-2026-0001' }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/BookingCreateRequest' } } }
        },
        responses: {
          200: { description: 'Booking updated', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, booking: { $ref: '#/components/schemas/Booking' } } } } } },
          400: { description: 'Invalid ID or format' },
          404: { description: 'Booking not found' },
          409: { description: 'Conflict (time overlap, room, or optimistic lock)' }
        }
      },
      delete: {
        tags: ['Bookings'],
        summary: 'Delete booking (soft or permanent)',
        description: 'Soft-delete sets status to cancelled. Permanent delete with ?permanent=true removes from DB. Also deletes linked bookings.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'permanent', in: 'query', schema: { type: 'boolean', default: false }, description: 'If true, permanently delete from DB' }
        ],
        responses: {
          200: { description: 'Booking deleted', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, permanent: { type: 'boolean' } } } } } },
          400: { description: 'Invalid booking ID' },
          404: { description: 'Booking not found' }
        }
      }
    },

    // ==========================================
    // LINES
    // ==========================================
    '/lines/{date}': {
      get: {
        tags: ['Lines'],
        summary: 'Get animator lines for a date',
        description: 'Returns lines (animators) for the given date. Creates defaults if none exist.',
        parameters: [
          { name: 'date', in: 'path', required: true, schema: { type: 'string', format: 'date' } }
        ],
        responses: {
          200: { description: 'Array of lines', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Line' } } } } }
        }
      },
      post: {
        tags: ['Lines'],
        summary: 'Save/replace animator lines for a date',
        description: 'Replaces all lines for the date with the provided array (transactional).',
        parameters: [
          { name: 'date', in: 'path', required: true, schema: { type: 'string', format: 'date' } }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Line' } } } }
        },
        responses: {
          200: { description: 'Lines saved', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
          400: { description: 'Invalid date or not an array' }
        }
      }
    },

    // ==========================================
    // HISTORY
    // ==========================================
    '/history': {
      get: {
        tags: ['History'],
        summary: 'Get action history with filters',
        parameters: [
          { name: 'action', in: 'query', schema: { type: 'string' }, description: 'Filter by action type' },
          { name: 'user', in: 'query', schema: { type: 'string' }, description: 'Filter by username' },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Full-text search in data and username' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 200, maximum: 500 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } }
        ],
        responses: {
          200: { description: 'Paginated history', content: { 'application/json': { schema: { $ref: '#/components/schemas/HistoryResponse' } } } }
        }
      },
      post: {
        tags: ['History'],
        summary: 'Add history entry',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['action', 'user', 'data'], properties: { action: { type: 'string' }, user: { type: 'string' }, data: { type: 'object' } } } } }
        },
        responses: {
          200: { description: 'Entry added', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
        }
      }
    },

    // ==========================================
    // PRODUCTS
    // ==========================================
    '/products': {
      get: {
        tags: ['Products'],
        summary: 'List all products',
        parameters: [
          { name: 'active', in: 'query', schema: { type: 'string', enum: ['true'] }, description: 'If true, only active products' }
        ],
        responses: {
          200: { description: 'Array of products', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Product' } } } } }
        }
      },
      post: {
        tags: ['Products'],
        summary: 'Create new product (admin/manager)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductCreateRequest' } } }
        },
        responses: {
          201: { description: 'Product created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Product' } } } },
          400: { description: 'Validation error' },
          403: { description: 'Insufficient role' }
        }
      }
    },
    '/products/{id}': {
      get: {
        tags: ['Products'],
        summary: 'Get single product by ID',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          200: { description: 'Product details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Product' } } } },
          404: { description: 'Product not found' }
        }
      },
      put: {
        tags: ['Products'],
        summary: 'Update product (admin/manager)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductCreateRequest' } } }
        },
        responses: {
          200: { description: 'Product updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Product' } } } },
          404: { description: 'Product not found' }
        }
      },
      delete: {
        tags: ['Products'],
        summary: 'Soft-delete (deactivate) product (admin only)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          200: { description: 'Product deactivated', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, product: { $ref: '#/components/schemas/Product' } } } } } },
          404: { description: 'Product not found' }
        }
      }
    },

    // ==========================================
    // AFISHA
    // ==========================================
    '/afisha': {
      get: {
        tags: ['Afisha'],
        summary: 'Get all afisha events',
        parameters: [
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['event', 'birthday', 'regular'] }, description: 'Filter by event type' }
        ],
        responses: {
          200: { description: 'Array of afisha events', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/AfishaEvent' } } } } }
        }
      },
      post: {
        tags: ['Afisha'],
        summary: 'Create afisha event',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AfishaCreateRequest' } } }
        },
        responses: {
          200: { description: 'Event created', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, item: { $ref: '#/components/schemas/AfishaEvent' } } } } } },
          400: { description: 'Missing required fields' }
        }
      }
    },
    '/afisha/templates/list': {
      get: {
        tags: ['Afisha'],
        summary: 'List recurring afisha templates',
        responses: {
          200: { description: 'Array of templates', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/AfishaTemplate' } } } } }
        }
      }
    },
    '/afisha/templates': {
      post: {
        tags: ['Afisha'],
        summary: 'Create recurring afisha template',
        description: 'Creates a template. If it matches today, an event is created immediately (eager-apply).',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AfishaTemplateCreateRequest' } } }
        },
        responses: {
          200: { description: 'Template created', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, template: { $ref: '#/components/schemas/AfishaTemplate' }, todayCreated: { type: 'boolean' } } } } } },
          400: { description: 'Missing title or time' }
        }
      }
    },
    '/afisha/templates/{id}': {
      put: {
        tags: ['Afisha'],
        summary: 'Update afisha template',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AfishaTemplateCreateRequest' } } }
        },
        responses: {
          200: { description: 'Template updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
        }
      },
      delete: {
        tags: ['Afisha'],
        summary: 'Delete afisha template',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        responses: {
          200: { description: 'Template deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
        }
      }
    },
    '/afisha/distribute/{date}': {
      get: {
        tags: ['Afisha'],
        summary: 'Preview fair distribution of events to animators',
        description: 'Returns suggested distribution without persisting. Round-robin by load, avoids time conflicts.',
        parameters: [
          { name: 'date', in: 'path', required: true, schema: { type: 'string', format: 'date' } }
        ],
        responses: {
          200: { description: 'Distribution preview', content: { 'application/json': { schema: { type: 'object', properties: { distribution: { type: 'array', items: { type: 'object' } }, animators: { type: 'array', items: { type: 'object' } }, events: { type: 'array', items: { $ref: '#/components/schemas/AfishaEvent' } } } } } } }
        }
      },
      post: {
        tags: ['Afisha'],
        summary: 'Execute auto-distribution (persist assignments)',
        description: 'Assigns line_id and adjusts time on afisha events. Transactional.',
        parameters: [
          { name: 'date', in: 'path', required: true, schema: { type: 'string', format: 'date' } }
        ],
        responses: {
          200: { description: 'Distribution applied', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, distribution: { type: 'array', items: { type: 'object' } } } } } } }
        }
      }
    },
    '/afisha/undistribute/{date}': {
      post: {
        tags: ['Afisha'],
        summary: 'Reset distribution (clear line_id, restore original times)',
        parameters: [
          { name: 'date', in: 'path', required: true, schema: { type: 'string', format: 'date' } }
        ],
        responses: {
          200: { description: 'Distribution reset', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, reset: { type: 'integer', description: 'Number of events reset' } } } } } }
        }
      }
    },
    '/afisha/{date}': {
      get: {
        tags: ['Afisha'],
        summary: 'Get afisha events for a specific date',
        description: 'Ensures recurring templates are applied before returning results.',
        parameters: [
          { name: 'date', in: 'path', required: true, schema: { type: 'string', format: 'date' } }
        ],
        responses: {
          200: { description: 'Array of events for date', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/AfishaEvent' } } } } }
        }
      }
    },
    '/afisha/{id}': {
      put: {
        tags: ['Afisha'],
        summary: 'Update afisha event',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AfishaCreateRequest' } } }
        },
        responses: {
          200: { description: 'Event updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
        }
      },
      delete: {
        tags: ['Afisha'],
        summary: 'Delete afisha event (cascades todo tasks)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        responses: {
          200: { description: 'Event deleted', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, deletedTasks: { type: 'integer' } } } } } }
        }
      }
    },
    '/afisha/{id}/generate-tasks': {
      post: {
        tags: ['Afisha'],
        summary: 'Generate tasks from afisha event',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        responses: {
          200: { description: 'Tasks generated', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, tasks: { type: 'array', items: { $ref: '#/components/schemas/Task' } }, count: { type: 'integer' } } } } } },
          404: { description: 'Event not found' },
          409: { description: 'Tasks already generated' }
        }
      }
    },
    '/afisha/{id}/time': {
      patch: {
        tags: ['Afisha'],
        summary: 'Quick time update (drag-to-move)',
        description: 'Updates only the time field. Max delta: 90min for templated, 120min for manual.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['time'], properties: { time: { type: 'string', example: '14:30' } } } } }
        },
        responses: {
          200: { description: 'Time updated', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, time: { type: 'string' }, originalTime: { type: 'string' } } } } } },
          400: { description: 'Invalid time or exceeds range' },
          404: { description: 'Event not found' }
        }
      }
    },

    // ==========================================
    // TASKS
    // ==========================================
    '/tasks': {
      get: {
        tags: ['Tasks'],
        summary: 'List tasks with optional filters',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['todo', 'in_progress', 'done'] } },
          { name: 'date', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'date_from', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'date_to', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'assigned_to', in: 'query', schema: { type: 'string' } },
          { name: 'afisha_id', in: 'query', schema: { type: 'integer' } },
          { name: 'type', in: 'query', schema: { type: 'string' } },
          { name: 'category', in: 'query', schema: { type: 'string', enum: ['event', 'purchase', 'admin', 'trampoline', 'personal', 'improvement'] } }
        ],
        responses: {
          200: { description: 'Array of tasks', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Task' } } } } }
        }
      },
      post: {
        tags: ['Tasks'],
        summary: 'Create task',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskCreateRequest' } } }
        },
        responses: {
          200: { description: 'Task created', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, task: { $ref: '#/components/schemas/Task' } } } } } },
          400: { description: 'Title required' }
        }
      }
    },
    '/tasks/{id}': {
      get: {
        tags: ['Tasks'],
        summary: 'Get single task',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        responses: {
          200: { description: 'Task details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } } },
          404: { description: 'Task not found' }
        }
      },
      put: {
        tags: ['Tasks'],
        summary: 'Full update task',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskCreateRequest' } } }
        },
        responses: {
          200: { description: 'Task updated', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, task: { $ref: '#/components/schemas/Task' } } } } } },
          404: { description: 'Task not found' }
        }
      },
      delete: {
        tags: ['Tasks'],
        summary: 'Delete task',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        responses: {
          200: { description: 'Task deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
          404: { description: 'Task not found' }
        }
      }
    },
    '/tasks/{id}/status': {
      patch: {
        tags: ['Tasks'],
        summary: 'Quick status change',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['todo', 'in_progress', 'done'] } } } } }
        },
        responses: {
          200: { description: 'Status updated', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, task: { $ref: '#/components/schemas/Task' } } } } } },
          400: { description: 'Invalid status' },
          404: { description: 'Task not found' }
        }
      }
    },

    '/tasks/{id}/logs': {
      get: {
        tags: ['Tasks'],
        summary: 'Get task change logs',
        description: 'Returns full history of task changes (status, assignment, escalation).',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        responses: {
          200: { description: 'Task logs', content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, taskId: { type: 'integer' }, action: { type: 'string' }, oldValue: { type: 'string', nullable: true }, newValue: { type: 'string', nullable: true }, actor: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } } } } } } }
        }
      }
    },

    // ==========================================
    // TASK TEMPLATES
    // ==========================================
    '/task-templates': {
      get: {
        tags: ['Task Templates'],
        summary: 'List all task templates',
        parameters: [
          { name: 'active', in: 'query', schema: { type: 'string', enum: ['true'] } }
        ],
        responses: {
          200: { description: 'Array of templates', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/TaskTemplate' } } } } }
        }
      },
      post: {
        tags: ['Task Templates'],
        summary: 'Create recurring task template',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskTemplateCreateRequest' } } }
        },
        responses: {
          200: { description: 'Template created', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, template: { $ref: '#/components/schemas/TaskTemplate' } } } } } },
          400: { description: 'Invalid input' }
        }
      }
    },
    '/task-templates/{id}': {
      put: {
        tags: ['Task Templates'],
        summary: 'Update task template',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskTemplateCreateRequest' } } }
        },
        responses: {
          200: { description: 'Template updated', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, template: { $ref: '#/components/schemas/TaskTemplate' } } } } } },
          404: { description: 'Template not found' }
        }
      },
      delete: {
        tags: ['Task Templates'],
        summary: 'Delete task template',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        responses: {
          200: { description: 'Template deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
          404: { description: 'Template not found' }
        }
      }
    },

    // ==========================================
    // STAFF
    // ==========================================
    '/staff/departments': {
      get: {
        tags: ['Staff'],
        summary: 'List department names',
        responses: {
          200: { description: 'Department map', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', example: { animators: 'Аніматори', admin: 'Адміністрація' } } } } } } }
        }
      }
    },
    '/staff/schedule': {
      get: {
        tags: ['Staff'],
        summary: 'Get schedule for date range',
        parameters: [
          { name: 'from', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', required: true, schema: { type: 'string', format: 'date' } }
        ],
        responses: {
          200: { description: 'Schedule entries with staff info', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { $ref: '#/components/schemas/StaffSchedule' } } } } } } },
          400: { description: 'Missing from/to' }
        }
      },
      put: {
        tags: ['Staff'],
        summary: 'Upsert single schedule entry',
        description: 'Insert or update (ON CONFLICT) a schedule entry for a staff member on a date. Sends Telegram notification.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ScheduleUpsertRequest' } } }
        },
        responses: {
          200: { description: 'Schedule entry saved', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/StaffSchedule' } } } } } },
          400: { description: 'Missing staffId or date' }
        }
      }
    },
    '/staff/schedule/bulk': {
      post: {
        tags: ['Staff'],
        summary: 'Upsert multiple schedule entries',
        description: 'Batch upsert up to 500 entries. Sends summary Telegram notification.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['entries'], properties: { entries: { type: 'array', items: { $ref: '#/components/schemas/ScheduleUpsertRequest' }, maxItems: 500 } } } } }
        },
        responses: {
          200: { description: 'Entries upserted', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, count: { type: 'integer' } } } } } },
          400: { description: 'Missing or empty entries array' }
        }
      }
    },
    '/staff/schedule/copy-week': {
      post: {
        tags: ['Staff'],
        summary: 'Copy schedule from one week to another',
        description: 'Copies 7 days of schedule entries. Optional department filter. Existing entries overwritten.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['fromMonday', 'toMonday'], properties: { fromMonday: { type: 'string', format: 'date', example: '2026-02-09' }, toMonday: { type: 'string', format: 'date', example: '2026-02-16' }, department: { type: 'string', nullable: true } } } } }
        },
        responses: {
          200: { description: 'Week copied', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, count: { type: 'integer' } } } } } }
        }
      }
    },
    '/staff/schedule/hours': {
      get: {
        tags: ['Staff'],
        summary: 'Calculate worked hours for date range',
        parameters: [
          { name: 'from', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', required: true, schema: { type: 'string', format: 'date' } }
        ],
        responses: {
          200: { description: 'Hours stats per staff member', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', description: 'Map of staffId to { name, totalHours, workingDays, ... }' } } } } } }
        }
      }
    },
    '/staff/schedule/check/{date}': {
      get: {
        tags: ['Staff'],
        summary: 'Check animator availability on a date',
        parameters: [
          { name: 'date', in: 'path', required: true, schema: { type: 'string', format: 'date' } }
        ],
        responses: {
          200: { description: 'Available and unavailable animators', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, available: { type: 'array', items: { type: 'object' } }, unavailable: { type: 'array', items: { type: 'object' } } } } } } }
        }
      }
    },
    '/staff': {
      get: {
        tags: ['Staff'],
        summary: 'List all staff',
        parameters: [
          { name: 'department', in: 'query', schema: { type: 'string' } },
          { name: 'active', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } }
        ],
        responses: {
          200: { description: 'Staff list', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { $ref: '#/components/schemas/StaffMember' } }, departments: { type: 'object' } } } } } }
        }
      },
      post: {
        tags: ['Staff'],
        summary: 'Create new employee',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/StaffCreateRequest' } } }
        },
        responses: {
          200: { description: 'Employee created', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/StaffMember' } } } } } },
          400: { description: 'Missing required fields' }
        }
      }
    },
    '/staff/{id}': {
      put: {
        tags: ['Staff'],
        summary: 'Update employee',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/StaffCreateRequest' } } }
        },
        responses: {
          200: { description: 'Employee updated', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/StaffMember' } } } } } },
          404: { description: 'Not found' }
        }
      },
      delete: {
        tags: ['Staff'],
        summary: 'Delete employee',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        responses: {
          200: { description: 'Employee deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
        }
      }
    },

    // ==========================================
    // CERTIFICATES
    // ==========================================
    '/certificates': {
      get: {
        tags: ['Certificates'],
        summary: 'List certificates with filters',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'used', 'expired', 'revoked', 'blocked'] } },
          { name: 'search', in: 'query', schema: { type: 'string', description: 'Search in display_value and cert_code' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100, maximum: 500 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } }
        ],
        responses: {
          200: { description: 'Paginated certificates', content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Certificate' } }, total: { type: 'integer' } } } } } }
        }
      },
      post: {
        tags: ['Certificates'],
        summary: 'Create new certificate (admin/user)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CertificateCreateRequest' } } }
        },
        responses: {
          201: { description: 'Certificate created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Certificate' } } } },
          400: { description: 'Validation error' }
        }
      }
    },
    '/certificates/batch': {
      post: {
        tags: ['Certificates'],
        summary: 'Batch-generate N blank certificates (admin/user)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CertificateBatchRequest' } } }
        },
        responses: {
          201: { description: 'Batch created', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, certificates: { type: 'array', items: { $ref: '#/components/schemas/Certificate' } } } } } } },
          400: { description: 'Invalid quantity' }
        }
      }
    },
    '/certificates/qr/{code}': {
      get: {
        tags: ['Certificates'],
        summary: 'Generate QR code deep link for certificate',
        parameters: [
          { name: 'code', in: 'path', required: true, schema: { type: 'string' }, description: 'Certificate code (e.g. PZP-AB12CD)' }
        ],
        responses: {
          200: { description: 'QR code data', content: { 'application/json': { schema: { type: 'object', properties: { dataUrl: { type: 'string', description: 'Data URL of QR code image' }, deepLink: { type: 'string' }, certCode: { type: 'string' } } } } } },
          404: { description: 'Certificate not found' }
        }
      }
    },
    '/certificates/code/{code}': {
      get: {
        tags: ['Certificates'],
        summary: 'Find certificate by cert_code',
        parameters: [
          { name: 'code', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          200: { description: 'Certificate found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Certificate' } } } },
          404: { description: 'Certificate not found' }
        }
      }
    },
    '/certificates/{id}': {
      get: {
        tags: ['Certificates'],
        summary: 'Get single certificate',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        responses: {
          200: { description: 'Certificate details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Certificate' } } } },
          404: { description: 'Certificate not found' }
        }
      },
      put: {
        tags: ['Certificates'],
        summary: 'Update certificate details (admin/user)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { displayValue: { type: 'string' }, typeText: { type: 'string' }, validUntil: { type: 'string', format: 'date' }, notes: { type: 'string', nullable: true } } } } }
        },
        responses: {
          200: { description: 'Certificate updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Certificate' } } } },
          404: { description: 'Certificate not found' }
        }
      },
      delete: {
        tags: ['Certificates'],
        summary: 'Delete certificate (admin/user)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        responses: {
          200: { description: 'Certificate deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
          404: { description: 'Certificate not found' }
        }
      }
    },
    '/certificates/{id}/status': {
      patch: {
        tags: ['Certificates'],
        summary: 'Change certificate status (admin/user)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['active', 'used', 'expired', 'revoked', 'blocked'] }, reason: { type: 'string', nullable: true } } } } }
        },
        responses: {
          200: { description: 'Status changed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Certificate' } } } },
          400: { description: 'Invalid status or already used/expired' },
          404: { description: 'Certificate not found' }
        }
      }
    },
    '/certificates/{id}/send-image': {
      post: {
        tags: ['Certificates'],
        summary: 'Send certificate image to Telegram (admin/user)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['imageBase64'], properties: { imageBase64: { type: 'string', description: 'Base64-encoded PNG image' } } } } }
        },
        responses: {
          200: { description: 'Image sent', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
          400: { description: 'Missing imageBase64 or no Telegram chat' },
          404: { description: 'Certificate not found' }
        }
      }
    },

    // ==========================================
    // TELEGRAM
    // ==========================================
    '/telegram/chats': {
      get: {
        tags: ['Telegram'],
        summary: 'List known Telegram chats',
        responses: {
          200: { description: 'Array of known chats', content: { 'application/json': { schema: { type: 'object', properties: { chats: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, title: { type: 'string' }, type: { type: 'string' } } } } } } } } }
        }
      }
    },
    '/telegram/threads': {
      get: {
        tags: ['Telegram'],
        summary: 'List known threads/topics for a chat',
        parameters: [
          { name: 'chat_id', in: 'query', schema: { type: 'string' }, description: 'Chat ID (defaults to configured)' }
        ],
        responses: {
          200: { description: 'Array of threads', content: { 'application/json': { schema: { type: 'object', properties: { threads: { type: 'array', items: { type: 'object', properties: { thread_id: { type: 'integer' }, title: { type: 'string', nullable: true } } } } } } } } }
        }
      }
    },
    '/telegram/notify': {
      post: {
        tags: ['Telegram'],
        summary: 'Send text notification to configured chat',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['text'], properties: { text: { type: 'string', description: 'HTML-formatted message text' } } } } }
        },
        responses: {
          200: { description: 'Send result', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, reason: { type: 'string', nullable: true } } } } } }
        }
      }
    },
    '/telegram/digest/{date}': {
      get: {
        tags: ['Telegram'],
        summary: 'Build and send daily digest for date',
        parameters: [
          { name: 'date', in: 'path', required: true, schema: { type: 'string', format: 'date' } }
        ],
        responses: {
          200: { description: 'Digest result', content: { 'application/json': { schema: { type: 'object' } } } }
        }
      }
    },
    '/telegram/reminder/{date}': {
      get: {
        tags: ['Telegram'],
        summary: 'Send tomorrow reminder for date',
        parameters: [
          { name: 'date', in: 'path', required: true, schema: { type: 'string', format: 'date' } }
        ],
        responses: {
          200: { description: 'Reminder result', content: { 'application/json': { schema: { type: 'object' } } } }
        }
      }
    },
    '/telegram/ask-animator': {
      post: {
        tags: ['Telegram'],
        summary: 'Send animator request via Telegram (inline keyboard)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['date'], properties: { date: { type: 'string', format: 'date' }, note: { type: 'string', nullable: true } } } } }
        },
        responses: {
          200: { description: 'Request sent', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, requestId: { type: 'integer' } } } } } }
        }
      }
    },
    '/telegram/animator-status/{id}': {
      get: {
        tags: ['Telegram'],
        summary: 'Check pending animator request status',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        responses: {
          200: { description: 'Request status', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'not_found'] } } } } } }
        }
      }
    },
    '/telegram/webhook': {
      post: {
        tags: ['Telegram'],
        summary: 'Telegram webhook handler',
        description: 'Handles callback queries (add/reject animator, cert use) and bot commands. Authenticated via X-Telegram-Bot-Api-Secret-Token header.',
        security: [],
        responses: {
          200: { description: 'Processed' },
          403: { description: 'Invalid secret token' }
        }
      }
    },

    // ==========================================
    // BACKUP
    // ==========================================
    '/backup/create': {
      post: {
        tags: ['Backup'],
        summary: 'Create and send backup to Telegram',
        responses: {
          200: { description: 'Backup result', content: { 'application/json': { schema: { type: 'object' } } } }
        }
      }
    },
    '/backup/download': {
      get: {
        tags: ['Backup'],
        summary: 'Download backup as SQL file',
        responses: {
          200: { description: 'SQL backup file', content: { 'application/sql': { schema: { type: 'string' } } } }
        }
      }
    },
    '/backup/restore': {
      post: {
        tags: ['Backup'],
        summary: 'Restore from SQL (INSERT/DELETE only)',
        description: 'Executes SQL statements from body. Only INSERT and DELETE are allowed.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['sql'], properties: { sql: { type: 'string', description: 'SQL statements (INSERT/DELETE only, separated by ;)' } } } } }
        },
        responses: {
          200: { description: 'Restore complete', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, executed: { type: 'integer' } } } } } },
          400: { description: 'Forbidden statements or missing SQL body' }
        }
      }
    },

    // ==========================================
    // SETTINGS (mounted at /api directly)
    // ==========================================
    '/stats/{dateFrom}/{dateTo}': {
      get: {
        tags: ['Settings'],
        summary: 'Get booking stats for date range',
        description: 'Returns non-linked, non-cancelled bookings for the given date range.',
        parameters: [
          { name: 'dateFrom', in: 'path', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'dateTo', in: 'path', required: true, schema: { type: 'string', format: 'date' } }
        ],
        responses: {
          200: { description: 'Array of bookings', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Booking' } } } } },
          400: { description: 'Invalid date format' }
        }
      }
    },
    '/settings/{key}': {
      get: {
        tags: ['Settings'],
        summary: 'Get setting value by key',
        parameters: [
          { name: 'key', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          200: { description: 'Setting value', content: { 'application/json': { schema: { type: 'object', properties: { value: { type: 'string', nullable: true } } } } } }
        }
      }
    },
    '/settings': {
      post: {
        tags: ['Settings'],
        summary: 'Create/update setting (key + value)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['key', 'value'], properties: { key: { type: 'string' }, value: { type: 'string', maxLength: 1000 } } } } }
        },
        responses: {
          200: { description: 'Setting saved', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
          400: { description: 'Invalid key or value' }
        }
      }
    },
    '/rooms/free/{date}/{time}/{duration}': {
      get: {
        tags: ['Settings'],
        summary: 'Get free rooms for time slot',
        parameters: [
          { name: 'date', in: 'path', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'time', in: 'path', required: true, schema: { type: 'string', example: '12:00' } },
          { name: 'duration', in: 'path', required: true, schema: { type: 'integer', example: 60 } }
        ],
        responses: {
          200: { description: 'Free and occupied rooms', content: { 'application/json': { schema: { type: 'object', properties: { free: { type: 'array', items: { type: 'string' } }, occupied: { type: 'array', items: { type: 'string' } }, total: { type: 'integer' } } } } } }
        }
      }
    },
    '/health': {
      get: {
        tags: ['Settings'],
        summary: 'Health check (DB connectivity)',
        security: [],
        responses: {
          200: { description: 'Health status', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' }, database: { type: 'string', example: 'connected' } } } } } }
        }
      }
    },
    '/automation-rules': {
      get: {
        tags: ['Automation'],
        summary: 'List automation rules',
        responses: {
          200: { description: 'Array of rules', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/AutomationRule' } } } } }
        }
      },
      post: {
        tags: ['Automation'],
        summary: 'Create automation rule',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AutomationRuleCreateRequest' } } }
        },
        responses: {
          200: { description: 'Rule created', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, rule: { $ref: '#/components/schemas/AutomationRule' } } } } } },
          400: { description: 'Missing required fields' }
        }
      }
    },
    '/automation-rules/{id}': {
      put: {
        tags: ['Automation'],
        summary: 'Update automation rule',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AutomationRuleCreateRequest' } } }
        },
        responses: {
          200: { description: 'Rule updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
        }
      },
      delete: {
        tags: ['Automation'],
        summary: 'Delete automation rule',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        responses: {
          200: { description: 'Rule deleted', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
        }
      }
    },

    // ==========================================
    // POINTS (v10.0)
    // ==========================================
    '/points': {
      get: {
        tags: ['Points'],
        summary: 'Leaderboard — all users points',
        description: 'Returns all users sorted by permanent points. Requires admin or user role.',
        responses: {
          200: { description: 'Leaderboard', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/UserPoints' } } } } },
          403: { description: 'Insufficient permissions (viewer role)' }
        }
      }
    },
    '/points/{username}': {
      get: {
        tags: ['Points'],
        summary: 'Get user current points',
        description: 'Users can see own points, admins can see any user.',
        parameters: [
          { name: 'username', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          200: { description: 'User points', content: { 'application/json': { schema: { $ref: '#/components/schemas/UserPoints' } } } },
          403: { description: 'Can only view own points (non-admin)' }
        }
      }
    },
    '/points/{username}/history': {
      get: {
        tags: ['Points'],
        summary: 'Point transaction history',
        description: 'Full history of point earnings/deductions. Own + admin access.',
        parameters: [
          { name: 'username', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0, maximum: 10000 } }
        ],
        responses: {
          200: { description: 'Transactions list', content: { 'application/json': { schema: { type: 'object', properties: { transactions: { type: 'array', items: { $ref: '#/components/schemas/PointTransaction' } }, total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' } } } } } },
          403: { description: 'Insufficient permissions' }
        }
      }
    },

    // ==========================================
    // KLESHNYA (v11.0)
    // ==========================================
    '/kleshnya/greeting': {
      get: {
        tags: ['Kleshnya'],
        summary: 'Get personalized daily greeting',
        description: 'Returns greeting based on bookings, tasks, streaks, time of day. Cached in DB with 4h TTL.',
        parameters: [
          { name: 'date', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Date for greeting context (default: today)' }
        ],
        responses: {
          200: { description: 'Greeting', content: { 'application/json': { schema: { $ref: '#/components/schemas/KleshnyaGreeting' } } } }
        }
      }
    },
    '/kleshnya/chat': {
      get: {
        tags: ['Kleshnya'],
        summary: 'Get chat history',
        description: 'Returns full chat history for current user.',
        responses: {
          200: { description: 'Chat messages', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/KleshnyaChatMessage' } } } } },
          401: { description: 'Not authenticated' }
        }
      },
      post: {
        tags: ['Kleshnya'],
        summary: 'Send message to Kleshnya chat',
        description: 'Saves user message, generates template-based response (AI agent hook ready).',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['message'], properties: { message: { type: 'string', example: 'Скільки бронювань сьогодні?' } } } } }
        },
        responses: {
          200: { description: 'Chat response', content: { 'application/json': { schema: { $ref: '#/components/schemas/KleshnyaChatResponse' } } } },
          400: { description: 'Message is required' },
          401: { description: 'Not authenticated' }
        }
      }
    },

    // ==========================================
    // RECURRING BOOKINGS (v9.0)
    // ==========================================
    '/recurring': {
      get: {
        tags: ['Recurring'],
        summary: 'List all recurring templates',
        description: 'Returns templates with instance counts, skip counts, and next upcoming date.',
        responses: {
          200: { description: 'Templates list', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/RecurringTemplate' } } } } }
        }
      },
      post: {
        tags: ['Recurring'],
        summary: 'Create recurring template + eager-generate',
        description: 'Creates template and immediately generates bookings for the horizon period (default 14 days).',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RecurringTemplateCreate' } } }
        },
        responses: {
          200: { description: 'Template created with generation result', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, template: { $ref: '#/components/schemas/RecurringTemplate' }, generation: { type: 'object', properties: { created: { type: 'integer' }, skipped: { type: 'integer' } } } } } } } },
          400: { description: 'Validation error' }
        }
      }
    },
    '/recurring/{id}': {
      put: {
        tags: ['Recurring'],
        summary: 'Update recurring template',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RecurringTemplateCreate' } } }
        },
        responses: {
          200: { description: 'Template updated', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, template: { $ref: '#/components/schemas/RecurringTemplate' } } } } } },
          404: { description: 'Template not found' }
        }
      },
      delete: {
        tags: ['Recurring'],
        summary: 'Delete (deactivate) recurring template',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          { name: 'deleteFuture', in: 'query', schema: { type: 'boolean', default: false }, description: 'Cancel all future booking instances' }
        ],
        responses: {
          200: { description: 'Template deactivated', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, cancelledBookings: { type: 'integer' } } } } } },
          404: { description: 'Template not found' }
        }
      }
    },
    '/recurring/{id}/pause': {
      post: {
        tags: ['Recurring'],
        summary: 'Toggle template active/paused',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        responses: {
          200: { description: 'Toggled', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, isActive: { type: 'boolean' } } } } } },
          404: { description: 'Template not found' }
        }
      }
    },
    '/recurring/{id}/generate': {
      post: {
        tags: ['Recurring'],
        summary: 'Manually generate bookings for N days',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: { horizonDays: { type: 'integer', default: 14 } } } } }
        },
        responses: {
          200: { description: 'Generation result', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, created: { type: 'integer' }, skipped: { type: 'integer' } } } } } },
          404: { description: 'Template not found' }
        }
      }
    },
    '/recurring/{id}/series': {
      get: {
        tags: ['Recurring'],
        summary: 'List all booking instances of a template',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } }
        ],
        responses: {
          200: { description: 'Booking instances', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Booking' } } } } }
        }
      }
    },
    '/recurring/{id}/series/future': {
      delete: {
        tags: ['Recurring'],
        summary: 'Cancel all future instances from a date',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Date from which to cancel (default: today)' }
        ],
        responses: {
          200: { description: 'Cancelled count', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, cancelledCount: { type: 'integer' } } } } } }
        }
      }
    },
    '/recurring/{id}/skips': {
      get: {
        tags: ['Recurring'],
        summary: 'List skips for a template',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        responses: {
          200: { description: 'Skips list', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/RecurringSkip' } } } } }
        }
      },
      post: {
        tags: ['Recurring'],
        summary: 'Manually skip a date',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['date'], properties: { date: { type: 'string', format: 'date' } } } } }
        },
        responses: {
          200: { description: 'Skipped', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, cancelledBookings: { type: 'integer' } } } } } },
          404: { description: 'Template not found' }
        }
      }
    },
    '/recurring/skips/{skipId}': {
      delete: {
        tags: ['Recurring'],
        summary: 'Remove skip (allow retry generation)',
        parameters: [
          { name: 'skipId', in: 'path', required: true, schema: { type: 'integer' } }
        ],
        responses: {
          200: { description: 'Skip removed', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
          404: { description: 'Skip not found' }
        }
      }
    },

    // ==========================================
    // STATS — Revenue Dashboard (v10.4)
    // ==========================================
    '/stats/revenue': {
      get: {
        tags: ['Stats'],
        summary: 'Revenue analytics with period comparison',
        description: 'Aggregated revenue, booking counts, daily breakdown. Compares with previous period. 5-min cache.',
        parameters: [
          { name: 'period', in: 'query', schema: { type: 'string', enum: ['day', 'week', 'month', 'quarter', 'year'], default: 'month' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Custom date range start' },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Custom date range end' }
        ],
        responses: {
          200: { description: 'Revenue data', content: { 'application/json': { schema: { $ref: '#/components/schemas/StatsRevenue' } } } },
          403: { description: 'Viewer role blocked' }
        }
      }
    },
    '/stats/programs': {
      get: {
        tags: ['Stats'],
        summary: 'Program popularity rankings',
        description: 'Top programs by count and revenue, category breakdown with percentages.',
        parameters: [
          { name: 'period', in: 'query', schema: { type: 'string', default: 'month' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 10, maximum: 50 } }
        ],
        responses: {
          200: { description: 'Program statistics with byCount, byRevenue, byCategory arrays' }
        }
      }
    },
    '/stats/load': {
      get: {
        tags: ['Stats'],
        summary: 'Workload analytics',
        description: 'Breakdown by day-of-week, hour, room utilization, and animator workload.',
        parameters: [
          { name: 'period', in: 'query', schema: { type: 'string', default: 'month' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' } }
        ],
        responses: {
          200: { description: 'Load data with byDayOfWeek, byHour, roomUtilization, animatorWorkload arrays' }
        }
      }
    },
    '/stats/trends': {
      get: {
        tags: ['Stats'],
        summary: 'Period-over-period trends',
        description: 'Current vs previous period comparison with growth percentages.',
        parameters: [
          { name: 'period', in: 'query', schema: { type: 'string', enum: ['day', 'week', 'month', 'quarter', 'year'], default: 'month' } }
        ],
        responses: {
          200: { description: 'Trends with current, previous, and growth objects' }
        }
      }
    },
    '/recurring/generate-all': {
      post: {
        tags: ['Recurring'],
        summary: 'Trigger generation for all active templates',
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', properties: { horizonDays: { type: 'integer' } } } } }
        },
        responses: {
          200: { description: 'Generation results', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
        }
      }
    }
  }
};

module.exports = { swaggerSpec };
