import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app';
import { HttpError, parse } from '../util';
import { AdviseBody, ClassifyBody, InterpretBody, ProposeBody, adviseTask, classifyTask, interpretTask, proposeTask } from '../ai/tasks';

export function aiRoutes(app: FastifyInstance, { ai }: Ctx): void {
  app.post('/api/ai/:task', async (req) => {
    const { task } = parse(z.object({ task: z.string() }), req.params);
    switch (task) {
      case 'advise':
        return adviseTask(ai, parse(AdviseBody, req.body));
      case 'interpret':
        return interpretTask(ai, parse(InterpretBody, req.body));
      case 'classify':
        return classifyTask(ai, parse(ClassifyBody, req.body));
      case 'propose':
        return proposeTask(ai, parse(ProposeBody, req.body));
      default:
        throw new HttpError(404, `unknown AI task "${task}"`);
    }
  });
}
