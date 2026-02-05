import type { Booking, Client, Event, Manager, Payment } from '@prisma/client';

export type { Booking, Client, Event, Manager, Payment } from '@prisma/client';
export * from './enums.js';

// ── API Response Types ──────────────────────────────────────────────

export interface PaginationMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

export interface ApiErrorDetail {
  field: string;
  message: string;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetail[];
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// ── JWT ─────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;
  role: 'ADMIN' | 'MANAGER' | 'VIEWER';
  iat: number;
  exp: number;
}

// ── Booking State Machine ───────────────────────────────────────────

export interface TransitionContext {
  actor: 'client' | 'manager' | 'system';
  actorId?: string;
  reason?: string;
  paymentAmount?: number;
}

export interface BookingTransition {
  from: string[];
  to: string;
  guards: string[];
  effects: string[];
}

// ── Notification ────────────────────────────────────────────────────

export interface TemplateContext {
  booking?: Booking & { event: Event; client: Client };
  payment?: Payment;
  event?: Event;
  manager?: Manager;
  client?: Client;
  custom?: Record<string, unknown>;
}

// ── Query Params ────────────────────────────────────────────────────

export interface PaginationQuery {
  page?: number;
  perPage?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
}

export interface BookingFilterQuery extends PaginationQuery {
  status?: string;
  eventId?: string;
  clientId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface EventFilterQuery extends PaginationQuery {
  status?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
}

// ── Booking with Relations ──────────────────────────────────────────

export type BookingWithRelations = Booking & {
  event: Event;
  client: Client;
  payments: Payment[];
};
