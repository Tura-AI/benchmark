import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import { getRouter } from './router'

export default createStartHandler(defaultStreamHandler)(() => getRouter())
