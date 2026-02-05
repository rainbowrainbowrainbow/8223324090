import type { FastifyInstance } from 'fastify';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { clientFilterQuery, updateClientSchema, uuidParam } from '../../types/schemas.js';
import { listClients, getClientById, updateClient, softDeleteClient } from '../../services/client/index.js';

export async function adminClientRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', authorize('ADMIN', 'MANAGER'));

  // GET /api/v1/admin/clients
  app.get(
    '/',
    { preHandler: [validate({ query: clientFilterQuery })] },
    async (request, reply) => {
      const query = request.query as {
        page: number;
        perPage: number;
        sort?: string;
        order?: 'asc' | 'desc';
        search?: string;
        source?: string;
      };

      const result = await listClients(query);

      return reply.send({
        success: true,
        data: result.data,
        meta: result.meta,
      });
    },
  );

  // GET /api/v1/admin/clients/:id
  app.get(
    '/:id',
    { preHandler: [validate({ params: uuidParam })] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const client = await getClientById(id);

      return reply.send({ success: true, data: client });
    },
  );

  // PUT /api/v1/admin/clients/:id
  app.put(
    '/:id',
    { preHandler: [validate({ params: uuidParam, body: updateClientSchema })] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const data = request.body as Record<string, unknown>;

      const client = await updateClient(id, data as any);

      return reply.send({ success: true, data: client });
    },
  );

  // DELETE /api/v1/admin/clients/:id (soft delete)
  app.delete(
    '/:id',
    { preHandler: [validate({ params: uuidParam }), authorize('ADMIN')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await softDeleteClient(id);

      return reply.send({ success: true, data: { id } });
    },
  );
}
