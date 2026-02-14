import type { AppModule } from '../_shared/app-types'
import { createRestApiActions } from './main'

export const app: AppModule = {
  id: 'restapi',
  name: 'REST API',
  pageTitle: 'Even Hub REST API Tester',
  connectLabel: 'Setup REST API',
  actionLabel: 'Run GET Request',
  initialStatus: 'REST API app ready',
  createActions: createRestApiActions,
}

export default app
