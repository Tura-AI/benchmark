import { StartClient } from '@tanstack/react-start/client'
import { hydrateRoot } from 'react-dom/client'
import { createRouter } from './router'

hydrateRoot(document, <StartClient router={createRouter()} />)
