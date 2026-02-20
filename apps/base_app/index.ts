import type { AppModule } from '../_shared/app-types'
import { createBaseAppActions } from './main'

export const app: AppModule = {
  id: 'base_app',
  name: 'Base Template',
  pageTitle: 'Even Hub Base App Template',
  connectLabel: 'Connect Base Template',
  actionLabel: 'Increment Counter',
  initialStatus: 'Base template ready',
  createActions: createBaseAppActions,
}

export default app
